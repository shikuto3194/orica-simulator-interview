/**
 * BSLH01-T07〜T17「攻撃アーツ」系 effects[0] 検証
 * (engine-quartz-arts-field-gate、cluster propose note (b))。
 * 【アーツ】配置ゲートは CardDefinition.summonCondition + continuousSummonCondition
 * (F2.4b⑤) に移動したため、effects[0] が系統免疫、effects[1] がフラッシュ payload。
 *
 * 原文 (textLines[0]):
 *   このカードはデッキに入れられず、系統：「CB」/「導力器」を持たない自分の効果を受けない。
 *
 * 実装: effect_immunity(target:self, sourcePlayerScope:"self",
 *   sourceScope:{excludeTribes:["CB","導力器"]}, duration:{scope:"while_on_field"})。
 * `immunitySourceScope.excludeTribes`(新設フィールド) は excludeCombined /
 * excludeGrandwalkerOrGuided と同型の「特定種別除外」軸で、発生源の実効系統
 * (`getEffectiveTribes`) がリストのいずれかに一致すれば scope 対象から除外する
 * （＝免疫が成立せず、効果は着弾する）。
 *
 * 検証点 (T07 を代表として使用、他 10 枚は data-shape レベルで
 * bslh01-cards.test.ts が担保):
 *  - 系統「CB」を持つ自分の効果の発生源には免疫が成立しない（着弾する）。
 *  - 系統「導力器」を持つ自分の効果の発生源には免疫が成立しない（着弾する）。
 *  - 系統「地球人」等 CB/導力器 以外の自分の効果の発生源には免疫が成立する（受けない）。
 *  - 相手起因の効果 (sourcePlayerScope:"self" のため無関係) には免疫が成立しない。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";

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
const T07 = card("BSLH01-T07");

function srcT07() {
  return createCardInstance(T07, {
    instanceId: "src-t07",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
}

function registerImmunity(): GameState {
  const src = srcT07();
  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [src],
  });
  return executeEffect({
    chainId: "test:bslh01-arts-tribe-immunity:61",
    state,
    effect: T07.effects[0]!,
    effectIndex: 0,
    sourceInstanceId: "src-t07",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
  });
}

describe("BSLH01-T07 effects[0]（系統：「CB」/「導力器」を持たない自分の効果を受けない）", () => {
  it("defense_immune CE が sourcePlayerScope:self + excludeTribes:[CB,導力器] で登録される", () => {
    const after = registerImmunity();
    const ce = after.activeContinuousEffects.find(
      (c) =>
        c.modifierTag === "defense_immune" && c.targetInstanceId === "src-t07"
    );
    expect(ce).toBeDefined();
    expect(ce!.immunityPlayerScope).toBe("self");
    expect(ce!.immunitySourceScope).toEqual({
      excludeTribes: ["CB", "導力器"],
    });
  });

  it("系統「CB」を持つ自分の効果の発生源には免疫が成立しない（着弾する）", () => {
    const after = registerImmunity();
    const target = after.cardInstances.find((c) => c.instanceId === "src-t07")!;
    const cbSource = card("BSLH01-C02"); // tribe: "CB"
    expect(cbSource.tribe).toBe("CB");
    expect(
      isCardImmuneToOpponentEffect(after, target, ALICE, "none", {
        definition: cbSource,
      })
    ).toBe(false);
  });

  it("系統「導力器」を持つ自分の効果の発生源には免疫が成立しない（着弾する）", () => {
    const after = registerImmunity();
    const target = after.cardInstances.find((c) => c.instanceId === "src-t07")!;
    const doryokukiSource = card("BSLH01-CX01"); // tribe: "導力器"
    expect(doryokukiSource.tribe).toBe("導力器");
    expect(
      isCardImmuneToOpponentEffect(after, target, ALICE, "none", {
        definition: doryokukiSource,
      })
    ).toBe(false);
  });

  it("系統「CB」/「導力器」以外の自分の効果の発生源には免疫が成立する（受けない）", () => {
    const after = registerImmunity();
    const target = after.cardInstances.find((c) => c.instanceId === "src-t07")!;
    const otherSource = card("BSDB01-C05"); // tribe: "地球人"
    expect(otherSource.tribe).toBe("地球人");
    expect(
      isCardImmuneToOpponentEffect(after, target, ALICE, "none", {
        definition: otherSource,
      })
    ).toBe(true);
  });

  it("相手起因の効果には免疫が成立しない（sourcePlayerScope:self のため対象外）", () => {
    const after = registerImmunity();
    const target = after.cardInstances.find((c) => c.instanceId === "src-t07")!;
    const otherSource = card("BSDB01-C05"); // tribe: "地球人"（本来ブロックされ得る系統）
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        definition: otherSource,
      })
    ).toBe(false);
  });
});
