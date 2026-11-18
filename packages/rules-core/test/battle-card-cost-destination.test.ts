import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  applyLegalAction,
  getLegalActions,
  useAttackAsAction,
} from "../src";
import type { CardDefinition, ContinuousEffect, GameState } from "../src";

const unit: CardDefinition = {
  cardNo: "TEST-CARD-COST",
  name: "支払い検証",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
const lookup = (id: string) => (id === unit.cardNo ? unit : undefined);
const gate = (id: string, destination?: "deck_bottom"): ContinuousEffect => ({
  effectId: id,
  sourceInstanceId: "gate",
  sourceDefinitionId: unit.cardNo,
  actingPlayerId: "bob",
  duration: { scope: "turn" },
  createdAtTurn: 1,
  createdAtAttackId: null,
  modifierTag: "battle_destroy_cost_gate_both",
  targetFilter: { player: "opponent" },
  metadata: {
    costTargetCategory: ["spirit", "ultimate"],
    ...(destination ? { costDestination: destination } : {}),
  },
});
function board(gates: ContinuousEffect[]): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: ["attacker", "a", "b", "tail"].map((id) =>
        createCardInstance(unit, {
          instanceId: id,
          ownerPlayerId: "alice",
          zone: id === "tail" ? "deck" : "field",
          normalCoreCount: id === "tail" ? 0 : 1,
        })
      ),
    }),
    turnNumber: 2,
    step: "attack",
    window: "none",
    activePlayerId: "alice",
    activeContinuousEffects: gates,
  };
}
const attack = (state: GameState, ids: string[]) =>
  useAttackAsAction({
    state,
    actingPlayerId: "alice",
    sourceInstanceId: "attacker",
    battleDestroyCostSourceInstanceIds: ids,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: undefined,
  });

describe("宣言時のカード支払い: 移動先ごとの処理", () => {
  it("既存の破壊支払いはトラッシュへ移動する", () => {
    expect(
      attack(board([gate("destroy")]), ["a"]).cardInstances.find(
        (c) => c.instanceId === "a"
      )?.zone
    ).toBe("trash");
  });
  it("デッキ下の支払いでは破壊せず既存デッキの後ろへ戻す", () => {
    const result = attack(board([gate("return", "deck_bottom")]), ["a"]);
    expect(
      result.cardInstances
        .filter((c) => c.zone === "deck")
        .map((c) => c.instanceId)
    ).toEqual(["tail", "a"]);
    expect(
      result.log.some(
        (line) => line.startsWith("effect:destroy:") && line.includes("a")
      )
    ).toBe(false);
  });
  it("破壊と返却の両割当を合法手から選び、それぞれ異なる盤面へ解決する", () => {
    const initial = board([gate("return", "deck_bottom"), gate("destroy")]);
    const actions = getLegalActions({
      state: initial,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
    }).filter((a) => a.kind === "attack" && a.sourceInstanceId === "attacker");
    expect(actions).toHaveLength(2);
    const zones = actions.map((action) => {
      const result = applyLegalAction({
        state: initial,
        action,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
      return ["a", "b"].map(
        (id) => result.cardInstances.find((c) => c.instanceId === id)?.zone
      );
    });
    expect(zones).toEqual(
      expect.arrayContaining([
        ["trash", "deck"],
        ["deck", "trash"],
      ])
    );
    expect(() =>
      attack(board([gate("destroy"), gate("return", "deck_bottom")]), ["a"])
    ).toThrow();
    expect(() => attack(initial, ["a", "a"])).toThrow();
  });
  it("返却先が塞がれたカードは候補に入らない", () => {
    const state = board([gate("return", "deck_bottom")]);
    const { targetFilter: _filter, ...protection } = gate("protected");
    state.activeContinuousEffects.push({
      ...protection,
      targetInstanceId: "a",
      modifierTag: "cannot_be_sent_to_deck",
      metadata: {},
    });
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
    });
    expect(
      actions.some(
        (a) => a.kind === "attack" && a.sourceInstanceId === "attacker"
      )
    ).toBe(true);
    expect(
      actions
        .filter((a) => a.kind === "attack" && a.sourceInstanceId === "attacker")
        .some(
          (a) =>
            "battleDestroyCostSourceInstanceIds" in a &&
            a.battleDestroyCostSourceInstanceIds?.includes("a")
        )
    ).toBe(false);
  });
});
