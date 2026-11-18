/**
 * BSES01 導界者ブレイヴ「スピリット状態のこのブレイヴはアタック/ブロックできない」検証。
 *
 * - card-data: effect[0] が continuous prevent_battle(attack+block) /
 *   applicability.combined=false で表現されていること。
 * - engine: restriction ["attack","block"] が prevent_battle_both タグの CE に
 *   正しくマップされること（旧 executePreventBattle は配列を直接テンプレート展開し
 *   "attack,block" になり、どの prevent_battle_* タグにも一致しなかった不具合の回帰防止）。
 * - スピリット状態(非合体)では CE が自身に登録され、合体中(attach 済み)では
 *   applicability.combined=false により登録されないこと。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function buildState(cardInstances: GameState["cardInstances"]): GameState {
  return {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    activePlayerId: "alice",
    step: "main",
    cardInstances,
  };
}

// 「スピリット状態のこのブレイヴはアタック/ブロックできない」を持つ BSES01 導界者ブレイヴ。
const BRAVE_NO = "BSES01-C02";

describe("BSES01 導界者ブレイヴ: スピリット状態のアタック/ブロック禁止", () => {
  const brave = cardNoMap.get(BRAVE_NO)!;

  it("card-data: effect[0] は continuous prevent_battle(attack+block) / combined=false", () => {
    const eff = brave.effects![0]!;
    expect(eff.timing).toEqual({ kind: "continuous" });
    expect(eff.applicability).toEqual({ combined: false });
    const action = eff.steps[0]!.action;
    expect(action.kind).toBe("prevent_battle");
    if (action.kind === "prevent_battle") {
      expect(action.target).toEqual({ kind: "self" });
      expect(action.restriction).toEqual(["attack", "block"]);
      expect(action.ruleStrength).toBe(true);
    }
  });

  it("スピリット状態(非合体)で場に出ると prevent_battle_both CE が自身に登録される", () => {
    const state = buildState([
      createCardInstance(brave, {
        instanceId: "brave-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
      }),
    ]);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const pb = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.targetInstanceId === "brave-1" &&
        ce.modifierTag === "prevent_battle_both"
    );
    expect(pb).toHaveLength(1);
    expect((pb[0]!.metadata as { ruleStrength?: boolean }).ruleStrength).toBe(
      true
    );
  });

  it("合体中(host へ attach 済み)は combined=false により CE が登録されない", () => {
    const state = buildState([
      createCardInstance(brave, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        attachedChildrenIds: ["brave-1"],
      }),
      createCardInstance(brave, {
        instanceId: "brave-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        attachedToInstanceId: "host-1",
      }),
    ]);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const pb = rebuilt.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "prevent_battle_both"
    );
    expect(pb).toHaveLength(0);
  });
});
