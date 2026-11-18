/**
 * BSTH01-XX02「博麗 霊夢」effects[2] Lv4『このスピリットのアタック時』検証。
 *
 * 原文 (textLines[9,10]):
 *   "Lv4『このスピリットのアタック時』"
 *   "このスピリットはブロックされず、スピリットとして扱わない。"
 *
 * 「スピリットとして扱わない」は BSTH03-M01 (アルティメット版) と同型の
 * override_properties.properties.excludeCategory:"spirit" で表現する
 * (engine-category-negation-override / getEffectiveCategory が SSOT、
 * P3-121 で card-filter/condition-eval 双方向とも解決済み)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { getEffectiveCategory } from "../src/mechanics/act-as-spirit";
import { matchesCardFilter } from "../src/card/card-filter";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";

describe("BSTH01-XX02 Lv4 アタック時: ブロック不可 + スピリットとして扱わない", () => {
  const def = getCardDefinitionById("BSTH01-XX02")!;
  const attackEffect = def.effects![2]!;

  it("effect 定義: unblockable + override_properties(excludeCategory:spirit) の2ステップ、stub 未設定、duration.scope は battle (BSTH03-M01 precedent 準拠)", () => {
    expect(attackEffect.applicability).toEqual({ level: { min: 4 } });
    expect(attackEffect.steps).toHaveLength(2);
    expect(attackEffect.steps[0]!.action).toMatchObject({
      kind: "unblockable",
      duration: { scope: "battle" },
    });
    expect(attackEffect.steps[1]!.action).toMatchObject({
      kind: "override_properties",
      target: { kind: "self" },
      properties: { excludeCategory: "spirit" },
      duration: { scope: "battle" },
    });
    expect(attackEffect.stub).toBeUndefined();
  });

  it("解決後: getEffectiveCategory が undefined になり、category:['spirit'] フィルタにマッチしなくなる", () => {
    const reimu = createCardInstance(def, {
      instanceId: "reimu-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 6,
    });
    const before: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [reimu],
      activePlayerId: ALICE,
      step: "attack",
      window: "none",
    };

    const after = executeEffect({
      chainId: "test:bsth01-xx02-lv4-category-negation:65",
      state: before,
      effect: attackEffect,
      sourceInstanceId: reimu.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });

    const card = after.cardInstances.find((c) => c.instanceId === "reimu-1")!;
    expect(getEffectiveCategory(after, card, def)).toBeUndefined();
    expect(
      matchesCardFilter(card, def, { category: ["spirit"] }, { state: after })
    ).toBe(false);
    // 印字 category そのものを破壊してはいない。
    expect(def.printedCategory).toBe("spirit");
  });
});
