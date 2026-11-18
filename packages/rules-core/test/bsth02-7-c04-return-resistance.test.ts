/**
 * BSTH02.7-C04「霧の倫敦人形」effects[1]:
 * 「系統：「幻想」と「導魔」/「動玩」を持つコスト4以上の自分のスピリットすべては
 * 相手の効果でフィールドから手札/手元/デッキに戻らない。」
 *
 * effect_resistance(resistsOutcome:["bounce","send_to_deck"]) + target:{kind:"filter",
 * filter:{tribesRequired:["幻想"], tribes:["導魔","動玩"], minCost:4}, count:"all"}
 * の class-wide 効果耐性 (BSTH02.7-R01 の core_below_min 版と同型)。
 *
 * 本テストの主眼: 「すべて」型 class-wide 効果は、後から場に出た対象カードにも
 * 自動的に適用されなければならない。effect_resistance の動的 filter 化判定
 * (structured-continuous-effects.ts isDynamicEligible) は従来 tribesRequired/minCost を
 * 含む filter を snapshot 経路 (登録時点の場カードのみ保護) にフォールバックさせていたため、
 * C04 の継続効果 CE が登録された**後**に召喚された対象は保護対象から漏れていた
 * (matchesEffectResistanceFilter が tribesRequired/minCost を未評価だったため、たとえ
 * 動的経路に乗せても誤マッチする状態でもあった)。両方を修正し、CE 登録後に召喚された
 * 対象も追従保護されることを検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
  rebuildContinuousEffectsFromField,
} from "../src/index";
import type { CardDefinition, GameState } from "../src/index";

const ALL_CARDS_MAP = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const card = (cardNo: string): CardDefinition => {
  const def = ALL_CARDS_MAP.get(cardNo);
  if (!def) throw new Error(`card not found: ${cardNo}`);
  return def;
};
const getCardDefinitionById = (id: string) => ALL_CARDS_MAP.get(id);
const emptyLookup = () => undefined;

const qualifyingSpirit: CardDefinition = {
  cardNo: "QUALIFYING-SPIRIT-C04",
  name: "適格スピリット",
  printedCategory: "spirit",
  colors: ["yellow"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  tribe: "幻想・導魔",
  sourceUrls: [],
  sourceConfidence: "C",
};

const lowCostSpirit: CardDefinition = {
  ...qualifyingSpirit,
  cardNo: "LOW-COST-SPIRIT-C04",
  cost: 3,
};

const wrongTribeSpirit: CardDefinition = {
  ...qualifyingSpirit,
  cardNo: "WRONG-TRIBE-SPIRIT-C04",
  tribe: "導魔",
};

function makeBounceSource(destination: "hand" | "set_aside"): CardDefinition {
  return {
    cardNo: `SRC-BOUNCE-${destination}`,
    name: "バウンス源",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: "all",
              },
              destination,
            },
          },
        ],
      },
    ],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

function makeSendToDeckSource(): CardDefinition {
  return {
    cardNo: "SRC-SEND-TO-DECK",
    name: "デッキ送り源",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: "all",
              },
              position: "bottom",
            },
          },
        ],
      },
    ],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

function makeBaseState(
  cardInstances: GameState["cardInstances"],
  activePlayerId: string
): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const seeded = { ...base, activePlayerId, cardInstances };
  return rebuildContinuousEffectsFromField(seeded, getCardDefinitionById);
}

describe("BSTH02.7-C04 effects[1]: 幻想&(導魔/動玩)コスト4以上 手札/手元/デッキ復帰耐性", () => {
  const c04 = card("BSTH02.7-C04");
  const returnResistance = c04.effects![1]!;

  it("DSL 構造: effect_resistance(resistsOutcome:[bounce,send_to_deck]) + tribesRequired/minCost filter", () => {
    expect(returnResistance.stub).toBeUndefined();
    const action = returnResistance.steps[0]!.action;
    expect(action.kind).toBe("effect_resistance");
    if (action.kind === "effect_resistance") {
      expect(action.resistsOutcome).toEqual(["bounce", "send_to_deck"]);
      expect(action.source).toBe("opponent_effect");
      if ("filter" in action.target) {
        expect(action.target.filter).toEqual({
          category: ["spirit"],
          tribes: ["導魔", "動玩"],
          tribesRequired: ["幻想"],
          minCost: 4,
        });
      }
    }
  });

  it("[board] CE 登録後に召喚された適格スピリットも自動的に保護される (動的filter、bounce)", () => {
    const src = makeBounceSource("hand");
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [c04.cardNo, c04],
      [qualifyingSpirit.cardNo, qualifyingSpirit],
    ]);
    // C04 の継続効果 CE は c04 のみが場にいる時点で登録する (適格スピリットはまだ不在)。
    const initial = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-bob",
          ownerPlayerId: "bob",
          zone: "field",
        }),
        createCardInstance(c04, {
          instanceId: "alice-c04",
          ownerPlayerId: "alice",
          zone: "field",
        }),
      ],
      "bob"
    );
    // CE 登録**後**に適格スピリットを場に追加する (rebuildContinuousEffectsFromField は
    // 再実行しない。「後から場に出たカードも自動的に保護対象に含める」ことの検証)。
    const lateSpirit = createCardInstance(qualifyingSpirit, {
      instanceId: "alice-late-spirit",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const state = {
      ...initial,
      cardInstances: [...initial.cardInstances, lateSpirit],
    };

    const getDef = (id: string) => defs.get(id);
    const result = flushPendingLeaves(
      executeEffect({
        chainId: "test:bsth02-7-c04-return-resistance:209",
        state,
        effect: src.effects![0]!,
        sourceInstanceId: "src-bob",
        actingPlayerId: "bob",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: emptyLookup,
      }),
      getDef
    );

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-late-spirit"
    )!;
    expect(after.zone).toBe("field");
  });

  it("[board] CE 登録後に召喚された適格スピリットも自動的に保護される (動的filter、send_to_deck)", () => {
    const src = makeSendToDeckSource();
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [c04.cardNo, c04],
      [qualifyingSpirit.cardNo, qualifyingSpirit],
    ]);
    const initial = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-bob",
          ownerPlayerId: "bob",
          zone: "field",
        }),
        createCardInstance(c04, {
          instanceId: "alice-c04",
          ownerPlayerId: "alice",
          zone: "field",
        }),
      ],
      "bob"
    );
    const lateSpirit = createCardInstance(qualifyingSpirit, {
      instanceId: "alice-late-spirit",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const state = {
      ...initial,
      cardInstances: [...initial.cardInstances, lateSpirit],
    };

    const getDef = (id: string) => defs.get(id);
    const result = flushPendingLeaves(
      executeEffect({
        chainId: "test:bsth02-7-c04-return-resistance:260",
        state,
        effect: src.effects![0]!,
        sourceInstanceId: "src-bob",
        actingPlayerId: "bob",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: emptyLookup,
      }),
      getDef
    );

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-late-spirit"
    )!;
    expect(after.zone).toBe("field");
  });

  it("[board] コスト3の同系統スピリットは耐性なくデッキに戻る (minCost:4未満は対象外)", () => {
    const src = makeSendToDeckSource();
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [c04.cardNo, c04],
      [lowCostSpirit.cardNo, lowCostSpirit],
    ]);
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-bob",
          ownerPlayerId: "bob",
          zone: "field",
        }),
        createCardInstance(c04, {
          instanceId: "alice-c04",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(lowCostSpirit, {
          instanceId: "alice-low-cost",
          ownerPlayerId: "alice",
          zone: "field",
        }),
      ],
      "bob"
    );

    const getDef = (id: string) => defs.get(id);
    const result = flushPendingLeaves(
      executeEffect({
        chainId: "test:bsth02-7-c04-return-resistance:307",
        state,
        effect: src.effects![0]!,
        sourceInstanceId: "src-bob",
        actingPlayerId: "bob",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: emptyLookup,
      }),
      getDef
    );

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-low-cost"
    )!;
    expect(after.zone).toBe("deck");
  });

  it("[board] 「幻想」を持たない導魔スピリットは耐性なく手札に戻る (tribesRequired 不一致)", () => {
    const src = makeBounceSource("hand");
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [c04.cardNo, c04],
      [wrongTribeSpirit.cardNo, wrongTribeSpirit],
    ]);
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-bob",
          ownerPlayerId: "bob",
          zone: "field",
        }),
        createCardInstance(c04, {
          instanceId: "alice-c04",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(wrongTribeSpirit, {
          instanceId: "alice-wrong-tribe",
          ownerPlayerId: "alice",
          zone: "field",
        }),
      ],
      "bob"
    );

    const result = flushPendingLeaves(
      executeEffect({
        chainId: "test:bsth02-7-c04-return-resistance:353",
        state,
        effect: src.effects![0]!,
        sourceInstanceId: "src-bob",
        actingPlayerId: "bob",
        getCardDefinitionById: (id) => defs.get(id),
        getRegisteredTriggeredEffectActions: emptyLookup,
      }),
      (id) => defs.get(id)
    );

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-wrong-tribe"
    )!;
    expect(after.zone).toBe("hand");
  });
});
