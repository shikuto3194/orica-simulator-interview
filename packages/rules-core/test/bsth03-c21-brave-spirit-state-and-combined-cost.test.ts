/**
 * BSTH03-C21「蓬莱の玉の枝」textLines[0] 検証:
 * 「スピリット状態のこのブレイヴは、アタック/ブロックできず、合体しているこのブレイヴの
 * コストは0になる。」
 *
 * - [0a] スピリット状態(非合体): continuous prevent_battle(attack+block) / combined=false
 *   (BSES01-C02 precedent, [[project_brave_spirit_state_battle_ban]])。
 * - [0b] 合体中: continuous override_properties.cost=0 / combined=true。
 *   getOverriddenProperties(...).cost が getEffectiveCost の SSOT (legal-actions-shared.ts)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  getOverriddenProperties,
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

const CARD_NO = "BSTH03-C21";

describe("BSTH03-C21 蓬莱の玉の枝: スピリット状態禁戦 / 合体中コスト0", () => {
  const brave = cardNoMap.get(CARD_NO)!;

  it("card-data: effects[0]/[1] の宣言が textLines[0] を正しく表現する", () => {
    const preventEff = brave.effects![0]!;
    expect(preventEff.applicability).toEqual({ combined: false });
    const preventAction = preventEff.steps[0]!.action;
    expect(preventAction.kind).toBe("prevent_battle");
    if (preventAction.kind === "prevent_battle") {
      expect(preventAction.target).toEqual({ kind: "self" });
      expect(preventAction.restriction).toEqual(["attack", "block"]);
      expect(preventAction.ruleStrength).toBe(true);
    }

    const costEff = brave.effects![1]!;
    expect(costEff.applicability).toEqual({ combined: true });
    const costAction = costEff.steps[0]!.action;
    expect(costAction.kind).toBe("override_properties");
    if (costAction.kind === "override_properties") {
      // 「このブレイヴ」= host へリダイレクトしない source_card (self は合体中に host へ redirect)。
      expect(costAction.target).toEqual({ kind: "source_card" });
      expect(costAction.properties.cost).toBe(0);
    }
  });

  it("スピリット状態(非合体)ではアタック/ブロック不可 CE のみ登録され、コスト上書きは無い", () => {
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

    const overridden = getOverriddenProperties(
      rebuilt,
      "brave-1",
      getCardDefinitionById
    );
    expect(overridden?.cost).toBeUndefined();
  });

  it("合体中(host へ attach 済み)ではコストが0に上書きされ、アタック/ブロック禁止CEは外れる", () => {
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

    const overridden = getOverriddenProperties(
      rebuilt,
      "brave-1",
      getCardDefinitionById
    );
    expect(overridden?.cost).toBe(0);
  });
});
