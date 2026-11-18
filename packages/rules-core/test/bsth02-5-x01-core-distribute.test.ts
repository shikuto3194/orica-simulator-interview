/**
 * BSTH02.5-X01 伊吹 萃香 effects[1] 検証。
 *
 * 原文: "ボイドからコア1個ずつを系統：「遊精」/「皇獣」を持つ自分のスピリットすべてに置ける。"
 *
 * count:"all" + mode:"one_each" + amount=99 (void 無制限) で「すべてに1個ずつ」を表現。
 * BSLH01-X04 の {min,max} 型 (「4体まで」) に対し、こちらは部分集合選択を許さない
 * 全体配分。executionMode:"optional" で発揮自体は opt-in (置「ける」=任意)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

describe("BSTH02.5-X01 伊吹 萃香 effects[1] core_distribute 全体配分", () => {
  const suika = card("BSTH02.5-X01");

  it("DSL 形状: effects[1] は core_distribute mode:'one_each' / count:'all' / 遊精・皇獣 spirit filter", () => {
    const summonEffect = suika.effects![1]!;
    const step = summonEffect.steps[0]!;
    expect(step.action.kind).toBe("core_distribute");
    const action = step.action as Extract<
      typeof step.action,
      { kind: "core_distribute" }
    >;
    expect(action.mode).toBe("one_each");
    expect(action.from).toEqual({ kind: "void", player: "self" });
    expect(action.to).toEqual({
      kind: "filter",
      player: "self",
      filter: { category: ["spirit"], tribes: ["遊精", "皇獣"] },
      count: "all",
    });
    expect(summonEffect.executionMode).toBe("optional");
    expect("stub" in summonEffect).toBe(false);
  });

  it("発揮時、自分の場の 遊精/皇獣 スピリットすべてに 1 個ずつ配置 (非該当は不変)", () => {
    const ALICE = "player-1";
    // 萃香自身も tribe "幻想・遊精・皇獣・地霊" を持つため filter に該当する
    // (text 「自分のスピリットすべて」= 「他の」記載が無いので源も含む)。
    const src = createCardInstance(suika, {
      instanceId: "alice-suika",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // BSTH06-C02 = 幻想・地霊・遊精
    const yuusei1 = createCardInstance(card("BSTH06-C02"), {
      instanceId: "alice-yuusei-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const yuusei2 = createCardInstance(card("BSTH06-C03"), {
      instanceId: "alice-yuusei-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // BSTH06-C01 = 幻想・地霊・皇獣
    const koujuu = createCardInstance(card("BSTH06-C01"), {
      instanceId: "alice-koujuu",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // 非該当 (遊精/皇獣 を持たない) スピリット = BSLH01-X03 (CB 系統)。
    const other = createCardInstance(card("BSLH01-X03"), {
      instanceId: "alice-other",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });

    const base = createEmptyGameState({
      playerIds: [ALICE, "player-2"],
      cardInstances: [src, yuusei1, yuusei2, koujuu, other],
    });
    const state: GameState = { ...base, activePlayerId: ALICE };

    const after = executeEffect({
      chainId: "test:bsth02-5-x01-core-distribute:97",
      state,
      effect: suika.effects![1]!,
      sourceInstanceId: "alice-suika",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });

    const f = (id: string) =>
      after.cardInstances.find((c) => c.instanceId === id)!;
    // 萃香自身 + 遊精×2 + 皇獣×1 = 4 体に +1 ずつ。
    expect(f("alice-suika").normalCoreCount).toBe(2);
    expect(f("alice-yuusei-1").normalCoreCount).toBe(2);
    expect(f("alice-yuusei-2").normalCoreCount).toBe(2);
    expect(f("alice-koujuu").normalCoreCount).toBe(2);
    // 非該当 (CB) は不変。
    expect(f("alice-other").normalCoreCount).toBe(1);
    // engine log で one_each 経路が走った事実を確認。
    expect(after.log.join("\n")).toContain(
      "effect:core_distribute:one_each:4cores->4targets"
    );
  });

  it("該当 0 体のときは silent no-op (log に 0cores が現れない)", () => {
    const ALICE = "player-1";
    const src = createCardInstance(suika, {
      instanceId: "alice-suika",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // 該当系統を一切持たないスピリットのみ。
    const other = createCardInstance(card("BSLH01-X03"), {
      instanceId: "alice-other",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, "player-2"],
      cardInstances: [src, other],
    });
    const state: GameState = { ...base, activePlayerId: ALICE };

    const after = executeEffect({
      chainId: "test:bsth02-5-x01-core-distribute:144",
      state,
      effect: suika.effects![1]!,
      sourceInstanceId: "alice-suika",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "alice-other")!
        .normalCoreCount
    ).toBe(1);
  });
});
