/**
 * BSTH07.8-C05「霧の湖」Lv1 フラッシュ (textLines[6,7]):
 *   "系統：「妖精」を持つ自分の導界者ネクサスがLv2のとき、自分のライフのコア1個を
 *    ボイドに置くことで、手札/トラッシュの系統：「妖精」を持つカード1枚を召喚できる。"
 *
 * 実装: condition: field_has(tribes:["妖精"], grandwalkerKind:"guided", minLevel/maxLevel:2)
 *   + steps: [core_move(life→void,1), summon(from_zone:[hand,trash], conditional_cost)]
 *   (BSTH01-C12[5,6] life→trash conditional_cost precedent と同型)。
 *
 * 検証: 妖精導界者ネクサスがLv2のとき、フラッシュ発揮で自分のライフコアが1個ボイドへ
 *   移動し、手札の妖精カードがフィールドへ召喚される（盤面変化）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";

describe("BSTH07.8-C05「霧の湖」Lv1フラッシュ", () => {
  const c = card("BSTH07.8-C05");
  const eff = c.effects![3]!;

  it("effects[3]: stub 解消済み、condition/steps が期待通り", () => {
    expect(eff.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(eff.executionMode).toBe("optional");
    expect(eff.stub).toBeUndefined();
    expect(eff.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        tribes: ["妖精"],
        grandwalkerKind: "guided",
        minLevel: 2,
        maxLevel: 2,
      },
    ]);
    expect(eff.steps[0]!.action.kind).toBe("core_move");
    expect(eff.steps[1]!.connector).toBe("conditional_cost");
    expect(eff.steps[1]!.action.kind).toBe("summon");
  });

  it("[board] ライフコア1個→ボイド、手札の妖精カードがフィールドへ召喚される", () => {
    const lake = createCardInstance(c, {
      instanceId: "lake-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    // 妖精導界者ネクサス Lv2: BSTH07.8-XX01「[導界者]リリーブラック」
    // (tribe:"導界者・幻想・妖精", grandwalkerData.kind:"guided", levelDefs[1].requiredCores:1)。
    const fairyGuidedNexus = card("BSTH07.8-XX01");
    const guidedNexusInstance = createCardInstance(fairyGuidedNexus, {
      instanceId: "guided-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount:
        fairyGuidedNexus.levelDefs![1]?.requiredCores ??
        fairyGuidedNexus.levelDefs![0]!.requiredCores,
    });
    const fairyCardInHand = card("BSTH07.8-M01");
    const handCard = createCardInstance(fairyCardInHand, {
      instanceId: "hand-fairy-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });

    let state = createEmptyGameState({
      cardInstances: [lake, guidedNexusInstance, handCard],
      playerOverrides: [
        {
          lifeNormalCoreCount: 3,
          voidNormalCoreCount: 0,
          reserveNormalCoreCount: 10,
        },
      ],
    });

    state = executeEffect({
      chainId: "test:bsth07-8-c05-fairy-life-cost-summon:89",
      state,
      effect: eff,
      sourceInstanceId: "lake-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const alice = state.players.find((p) => p.id === ALICE)!;
    expect(alice.lifeNormalCoreCount).toBe(2);
    expect(alice.voidNormalCoreCount).toBe(1);
    const summoned = state.cardInstances.find(
      (ci) => ci.instanceId === "hand-fairy-1"
    );
    expect(summoned?.zone).toBe("field");
  });
});
