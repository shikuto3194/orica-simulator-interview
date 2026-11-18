/**
 * BSTH001-C03「魔界」effects[2] 検証。
 *
 * 原文 (textLines[5,6]):
 *   Lv2『自分のアタックステップ』
 *   系統：「靈異」を持つ自分の紫のスピリットがアタックしている間、相手は3コスト余分に
 *   支払わなければマジックカードのフラッシュ効果を使用できない。
 *
 * field_has.battleState:"attacking"（BSAZ02-C17 同型）+ cost_modify player:"opponent"
 * cardFilter.usingEffectMode:["flash"]（BSDB01-X02 同型 additional_cost CE）の既存
 * プリミティブ組み合わせのみで表現できる（stub-readiness の「条件付き追加コストはDSL未対応」
 * 判定は誤り、新規プリミティブ不要）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import { getApplicableAdditionalCostDelta } from "../src/card/card-filter";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";
const C03 = card("BSTH001-C03");
// 靈異/紫のスピリット候補: BSTH001-X01 (printedCategory:"spirit", colors:["purple"], tribe「起幻・幻想・靈異」)。
const PURPLE_SPIRIT = card("BSTH001-X01");
// 相手マジックカード候補（category:"magic" ならなんでもよい）。
const OPPONENT_MAGIC = card("BSTH001-C06");

describe("BSTH001-C03 魔界 effects[2]（Lv2『自分のアタックステップ』靈異紫スピ攻撃中の相手マジックフラッシュ税）", () => {
  const tax = C03.effects![2]!;

  it("stub 解消済み、condition/action がプリミティブ組み合わせで表現されている", () => {
    expect(tax.stub).toBeUndefined();
    expect(tax.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "step_phase", step: "attack", whose: "self" },
      {
        kind: "field_has",
        player: "self",
        category: ["spirit"],
        colors: ["purple"],
        tribes: ["靈異"],
        battleState: "attacking",
        minCount: 1,
      },
    ]);
    const action = tax.steps[0]!.action;
    expect(action.kind).toBe("cost_modify");
    if (action.kind === "cost_modify") {
      expect(action.player).toBe("opponent");
      expect(action.cardFilter).toEqual({
        category: ["magic"],
        usingEffectMode: ["flash"],
      });
      expect(action.modifier).toEqual({ additionalCostValue: 3 });
      expect(action.duration).toEqual({ scope: "while_on_field" });
    }
  });

  function buildState(opts: {
    nexusLevel: 1 | 2;
    attackState: "idle" | "attacking";
  }) {
    const nexus = createCardInstance(C03, {
      instanceId: "self-c03",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: opts.nexusLevel === 2 ? 1 : 0,
    });
    const spirit = createCardInstance(PURPLE_SPIRIT, {
      instanceId: "purple-reiy-spirit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const magic = createCardInstance(OPPONENT_MAGIC, {
      instanceId: "bob-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [nexus, spirit, magic],
        battleEntities:
          opts.attackState === "idle"
            ? []
            : [
                {
                  entityId: "be-purple-reiy-spirit",
                  memberInstanceIds: ["purple-reiy-spirit"],
                  resolvedBp: 1000,
                  resolvedSymbols: [],
                  attackState: opts.attackState,
                },
              ],
      }),
      activePlayerId: ALICE,
      step: "attack" as const,
    };
    return rebuildContinuousEffectsFromField(state, getDef);
  }

  it("[board] Lv2＆靈異紫スピがアタック中: 相手マジックのフラッシュ使用コストに+3", () => {
    const after = buildState({ nexusLevel: 2, attackState: "attacking" });
    expect(
      getApplicableAdditionalCostDelta(after, BOB, OPPONENT_MAGIC, {
        card: after.cardInstances.find((c) => c.instanceId === "bob-magic")!,
        cardZone: "hand",
        cardEffectMode: "flash",
        getCardDefinitionById: getDef,
      })
    ).toBe(3);
  });

  it("[board] main 効果使用は課税対象外（usingEffectMode:['flash'] 限定）", () => {
    const after = buildState({ nexusLevel: 2, attackState: "attacking" });
    expect(
      getApplicableAdditionalCostDelta(after, BOB, OPPONENT_MAGIC, {
        card: after.cardInstances.find((c) => c.instanceId === "bob-magic")!,
        cardZone: "hand",
        cardEffectMode: "main",
        getCardDefinitionById: getDef,
      })
    ).toBe(0);
  });

  it("[board] 靈異紫スピがアイドル状態（アタック外）: 課税されない", () => {
    const after = buildState({ nexusLevel: 2, attackState: "idle" });
    expect(
      getApplicableAdditionalCostDelta(after, BOB, OPPONENT_MAGIC, {
        card: after.cardInstances.find((c) => c.instanceId === "bob-magic")!,
        cardZone: "hand",
        cardEffectMode: "flash",
        getCardDefinitionById: getDef,
      })
    ).toBe(0);
  });

  it("[board] ネクサスがLv1（Lv2未満）: アタック中でも課税されない", () => {
    const after = buildState({ nexusLevel: 1, attackState: "attacking" });
    expect(
      getApplicableAdditionalCostDelta(after, BOB, OPPONENT_MAGIC, {
        card: after.cardInstances.find((c) => c.instanceId === "bob-magic")!,
        cardZone: "hand",
        cardEffectMode: "flash",
        getCardDefinitionById: getDef,
      })
    ).toBe(0);
  });
});
