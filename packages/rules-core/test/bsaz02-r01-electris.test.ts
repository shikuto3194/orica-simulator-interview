/**
 * BSAZ02-R01「エレクトリス」effects[0,1,2] 検証。
 *
 * 原文 (textLines[2,4,5,7,8,10,11]):
 *   【アルドノアドライブ：1】
 *   Lv3-Lv4『このアルティメットの召喚/アタック/ブロック時』
 *   ターンに1回、本来のコスト7以下の相手のスピリット/ネクサス3つまでをデッキの下に戻せる。
 *   Lv3-Lv4 このアルティメットは、相手のスピリット／ネクサスの効果を受けない。
 *   Lv3-Lv4『このアルティメットのアタック時』
 *   相手は手札のスピリットカード/アルティメットカード/ネクサスカードを使用できない。
 *
 * 検証点:
 *  - effects[0]: 閾値 (本来のコスト7以下、needs-ruling.jsonl BSAZ02-R01 解決済み) の
 *    send_to_deck + card_event(summon/attack/block) + per_instance ターン1回制限
 *    (BSAZ02-C15 / BSES01-M04 precedent と同型)。
 *  - effects[1]: 相手スピリット/ネクサス発生源には免疫が成立し、相手アルティメット発生源には
 *    成立しない (BSAZ02-C05 effects[2] precedent と同型)。
 *  - effects[2]: 『アタック時』相手の手札のスピリット/アルティメット/ネクサスカードの使用が
 *    restrict_use CE (duration:{scope:"attack"}) で禁止され、マジックカードは対象外
 *    (BSTH03-転醒X01(B) precedent と同型)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import { isCardUseRestricted } from "../src/legal/legal-actions-shared";
import { flushPendingLeaves } from "../src/state-based-actions";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noTriggerLookup = () => [];

const ALICE = "player-1";
const BOB = "player-2";
const R01 = card("BSAZ02-R01");

function srcR01(cores: number) {
  const src = createCardInstance(R01, {
    instanceId: "src-r01",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
  });
  return {
    ...src,
    underCards: [
      {
        cardInstanceId: "under-drive",
        role: "text_role" as const,
        roleTag: "アルドノアドライブ",
      },
    ],
  };
}

function underFiller() {
  return createCardInstance(card("BSAZ02-M01"), {
    instanceId: "under-drive",
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: "src-r01",
  });
}

function runEffect(state: GameState, effectIndex: number): GameState {
  return executeEffect({
    chainId: "test:bsaz02-r01-electris:75",
    state,
    effect: R01.effects[effectIndex]!,
    effectIndex,
    sourceInstanceId: "src-r01",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
}

describe("BSAZ02-R01 effects[0]（Lv3-4『召喚/アタック/ブロック時』ターンに1回、本来のコスト7以下の相手のスピリット/ネクサス3つまでをデッキ下に戻せる）", () => {
  function opponentCard(
    no: string,
    category: "spirit" | "nexus",
    cost: number
  ): CardDefinition {
    return {
      cardNo: no,
      name: no,
      printedCategory: category,
      colors: ["red"],
      cost,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: category === "spirit" ? 1 : 0,
          bp: category === "spirit" ? 3000 : 0,
        },
      ],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    } as CardDefinition;
  }

  const cheapSpirit = opponentCard("TEST-R01-CHEAP-SPIRIT", "spirit", 7);
  const cheapNexus = opponentCard("TEST-R01-CHEAP-NEXUS", "nexus", 3);
  const expensiveSpirit = opponentCard(
    "TEST-R01-EXPENSIVE-SPIRIT",
    "spirit",
    8
  );

  function getDefWithOpponentCards(id: string): CardDefinition | undefined {
    if (id === cheapSpirit.cardNo) return cheapSpirit;
    if (id === cheapNexus.cardNo) return cheapNexus;
    if (id === expensiveSpirit.cardNo) return expensiveSpirit;
    return getDef(id);
  }

  const effect0 = R01.effects[0]!;

  it("DSL構造: card_event(summon/attack/block) + per_instance ターン1回 + send_to_deck(maxCost:7/printed, count 0..3, opponent spirit/nexus)", () => {
    expect(effect0.timing).toEqual({
      kind: "card_event",
      event: ["summon", "attack", "block"],
    });
    expect(effect0.applicability).toEqual({ level: { min: 3, max: 4 } });
    expect(effect0.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
      maxCount: 1,
    });
    expect(effect0.executionMode).toBe("optional");
    const send = effect0.steps[0]!.action;
    expect(send.kind).toBe("send_to_deck");
    if (send.kind === "send_to_deck") {
      expect(send.position).toBe("bottom");
      expect(send.target.kind).toBe("filter");
      if (send.target.kind === "filter") {
        expect(send.target.player).toBe("opponent");
        expect(send.target.filter).toMatchObject({
          category: ["spirit", "nexus"],
          maxCost: 7,
          costBasis: "printed",
        });
        expect(send.target.count).toEqual({ min: 0, max: 3 });
      }
    }
  });

  it("アルドノアドライブ保持時、相手のスピリット/ネクサスをまとめてデッキ下へ戻せる", () => {
    const src = srcR01(1); // Lv3
    const oppSpirit = createCardInstance(cheapSpirit, {
      instanceId: "opp-cheap-spirit",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const oppNexus = createCardInstance(cheapNexus, {
      instanceId: "opp-cheap-nexus",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), oppSpirit, oppNexus],
    });
    const after = flushPendingLeaves(
      executeEffect({
        chainId: "test:bsaz02-r01-electris:177",
        state,
        effect: effect0,
        effectIndex: 0,
        sourceInstanceId: "src-r01",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDefWithOpponentCards,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        targetInstanceIds: ["opp-cheap-spirit", "opp-cheap-nexus"],
      }),
      getDefWithOpponentCards
    );
    expect(
      after.cardInstances.find((c) => c.instanceId === "opp-cheap-spirit")?.zone
    ).toBe("deck");
    expect(
      after.cardInstances.find((c) => c.instanceId === "opp-cheap-nexus")?.zone
    ).toBe("deck");
  });

  it("本来のコスト7以下フィルタ: 候補解決 (preSelectedIds無し) で本来のコスト8のカードは対象候補から除外される", () => {
    const src = srcR01(1); // Lv3
    const oppCheap = createCardInstance(cheapSpirit, {
      instanceId: "opp-cheap-spirit",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const oppExpensive = createCardInstance(expensiveSpirit, {
      instanceId: "opp-expensive-spirit",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), oppCheap, oppExpensive],
    });
    // targetInstanceIds 未指定で候補解決に委ねる。rangeAutoResolveStrategy:"max" で
    // count:{min:0,max:3} の静的上限まで自動採用させ、maxCost:7 フィルタでの除外を検証する
    // (executeEffect オプションの用途どおり preSelectedIds 無し経路)。
    const after = flushPendingLeaves(
      executeEffect({
        chainId: "test:bsaz02-r01-electris:217",
        state,
        effect: effect0,
        effectIndex: 0,
        sourceInstanceId: "src-r01",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDefWithOpponentCards,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        rangeAutoResolveStrategy: "max",
      }),
      getDefWithOpponentCards
    );
    expect(
      after.cardInstances.find((c) => c.instanceId === "opp-cheap-spirit")?.zone
    ).toBe("deck");
    expect(
      after.cardInstances.find((c) => c.instanceId === "opp-expensive-spirit")
        ?.zone
    ).toBe("field");
  });

  it("アルドノアドライブが無ければ効果は発動しない（condition gate、盤面据え置き）", () => {
    const src = createCardInstance(R01, {
      instanceId: "src-r01",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const oppSpirit = createCardInstance(cheapSpirit, {
      instanceId: "opp-cheap-spirit",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, oppSpirit],
    });
    const after = executeEffect({
      chainId: "test:bsaz02-r01-electris:254",
      state,
      effect: effect0,
      effectIndex: 0,
      sourceInstanceId: "src-r01",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithOpponentCards,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: ["opp-cheap-spirit"],
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "opp-cheap-spirit")?.zone
    ).toBe("field");
  });
});

describe("BSAZ02-R01 effects[1]（Lv3-4: 相手のスピリット／ネクサスの効果を受けない）", () => {
  it("相手スピリット/ネクサス発生源には免疫が成立し、相手アルティメット発生源には成立しない", () => {
    const src = srcR01(1); // Lv3
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller()],
    });
    const after = runEffect(state, 1);
    const target = after.cardInstances.find((c) => c.instanceId === "src-r01")!;

    const spiritSource = card("BSDB01-C05");
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        definition: spiritSource,
      })
    ).toBe(true);

    const nexusSource = card("BSAZ02-C09");
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        definition: nexusSource,
      })
    ).toBe(true);

    const ultimateSource = card("BSAZ02-C01");
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        definition: ultimateSource,
      })
    ).toBe(false);
  });

  it("アルドノアドライブが無ければ免疫は成立しない", () => {
    const src = createCardInstance(R01, {
      instanceId: "src-r01",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src],
    });
    // condition (self_under_card_count) 不成立のため effect は無効のまま。
    const after = runEffect(state, 1);
    const target = after.cardInstances.find((c) => c.instanceId === "src-r01")!;
    const spiritSource = card("BSDB01-C05");
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        definition: spiritSource,
      })
    ).toBe(false);
  });
});

describe("BSAZ02-R01 effects[2]（Lv3-4『アタック時』: 相手は手札のスピリット/アルティメット/ネクサスカードを使用できない）", () => {
  it("発揮後、相手 (BOB) の手札スピリットカードの使用が restrict_use CE で禁止される", () => {
    const src = srcR01(3); // Lv4
    const enemySpiritInHand = createCardInstance(card("BSDB01-C05"), {
      instanceId: "enemy-spirit-hand",
      ownerPlayerId: BOB,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), enemySpiritInHand],
    });
    const after = runEffect(
      {
        ...state,
        battleEntities: [
          {
            entityId: "attack",
            memberInstanceIds: ["src-r01"],
            attackState: "attacking",
            resolvedBp: 15000,
            resolvedSymbols: ["ultimate_symbol"],
          },
        ],
      },
      2
    );

    const restrictCe = after.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "restrict_use"
    );
    expect(restrictCe).toBeDefined();
    expect(restrictCe?.duration).toEqual({ scope: "while_on_field" });

    const spiritDef = card("BSDB01-C05");
    expect(
      isCardUseRestricted(after, BOB, enemySpiritInHand, spiritDef, getDef)
    ).toBe(true);

    // 発揮元 (ALICE) 自身の手札使用は制限されない。
    expect(
      isCardUseRestricted(
        { ...after, activePlayerId: ALICE },
        ALICE,
        {
          ...enemySpiritInHand,
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
        },
        spiritDef,
        getDef
      )
    ).toBe(false);
  });

  it("マジックカードは対象外 (category フィルタで除外される)", () => {
    const src = srcR01(3); // Lv4
    const magicInHand = createCardInstance(card("BSAZ02-C15"), {
      instanceId: "enemy-magic-hand",
      ownerPlayerId: BOB,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), magicInHand],
    });
    const after = runEffect(
      {
        ...state,
        battleEntities: [
          {
            entityId: "attack",
            memberInstanceIds: ["src-r01"],
            attackState: "attacking",
            resolvedBp: 15000,
            resolvedSymbols: ["ultimate_symbol"],
          },
        ],
      },
      2
    );
    const magicDef = card("BSAZ02-C15");
    expect(isCardUseRestricted(after, BOB, magicInHand, magicDef, getDef)).toBe(
      false
    );
  });
});
