/**
 * BSTH02-X04 [妖々夢]霧雨 魔理沙 の「BP-N → BP0 連動 (デッキ下戻し / 破壊)」検証。
 * BP0 連動は maxBp:0 フィルタ (BSAZ01-C01 の BP0破壊 と同型)、行き先は send_to_deck。
 * effects[0] = デッキ下戻し固定、effects[2]/[3] = デッキ下戻し or 破壊の二択。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const card = cardNoMap.get("BSTH02-X04")!;

function setup() {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const self = createCardInstance(card, {
    instanceId: "mari-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    level: 2,
    normalCoreCount: 3,
  });
  // BP5000 のバトルしていない相手スピリット。
  const target = createCardInstance(cardNoMap.get("BSDB01-C02")!, {
    instanceId: "tgt-1",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 1,
  });
  const state: GameState = {
    ...base,
    activePlayerId: "alice",
    step: "attack",
    cardInstances: [self, target],
  };
  return state;
}

describe("BSTH02-X04 BP0 連動 (デッキ下戻し / 破壊)", () => {
  it("構造: stub なし / バースト[0]=send_to_deck(bottom) / [2][3]=send_to_deck+choice destroy", () => {
    expect(card.effects![0]!.stub).toBeUndefined();
    expect(card.effects![2]!.stub).toBeUndefined();
    expect(card.effects![3]!.stub).toBeUndefined();
    // バースト[0]: bp_modify → send_to_deck(bottom) → summon。
    const burst = card.effects![0]!;
    expect(burst.steps[1]!.action.kind).toBe("send_to_deck");
    if (burst.steps[1]!.action.kind === "send_to_deck")
      expect(burst.steps[1]!.action.position).toBe("bottom");
    expect(burst.steps[2]).toMatchObject({
      action: {
        kind: "summon",
        target: { kind: "self" },
        costModifier: "free",
      },
      connector: "sequential",
    });
    // [2] attack: bp_modify(not_in_battle) → send_to_deck + choice[destroy]。
    const atk = card.effects![2]!;
    const bp = atk.steps[0]!.action;
    if (bp.kind === "bp_modify" && bp.target.kind === "filter")
      expect(bp.target.filter.battleState).toBe("not_in_battle");
    expect(atk.steps[1]!.action.kind).toBe("send_to_deck");
    expect(atk.steps[1]!.choice).toHaveLength(1);
    expect(atk.steps[1]!.choice![0]!.action.kind).toBe("destroy");
  });

  it("実行(既定 choice): BP-12000 で BP0 → デッキ下へ戻す (バースト[0])", () => {
    const state = setup();
    const result = flushPendingLeaves(
      executeEffect({
        chainId: "test:bsth02-x04-bp0-deck-or-destroy:81",
        state,
        effect: card.effects![0]!,
        sourceInstanceId: "mari-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
      }),
      getCardDefinitionById
    );
    const moved = result.cardInstances.find((c) => c.instanceId === "tgt-1")!;
    expect(moved.zone).toBe("deck");
  });

  it("実行(既定 choice): アタック時 BP-10000 で BP0 → デッキ下へ戻す ([2])", () => {
    const state = setup();
    const result = flushPendingLeaves(
      executeEffect({
        chainId: "test:bsth02-x04-bp0-deck-or-destroy:97",
        state,
        effect: card.effects![2]!,
        sourceInstanceId: "mari-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
      }),
      getCardDefinitionById
    );
    const moved = result.cardInstances.find((c) => c.instanceId === "tgt-1")!;
    expect(moved.zone).toBe("deck");
  });

  it("実行(choiceIndex=1 破壊): アタック時 BP-10000 で BP0 → 破壊 enqueue ([2])", () => {
    const state = setup();
    const result = executeEffect({
      chainId: "test:bsth02-x04-bp0-deck-or-destroy:112",
      state,
      effect: card.effects![2]!,
      sourceInstanceId: "mari-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      choiceIndex: 1,
    });
    expect(
      result.pendingLeaveEntities.find(
        (e) => e.instanceId === "tgt-1" && e.kind === "destroy"
      )
    ).toBeDefined();
  });
});
