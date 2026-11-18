/**
 * BSTH02.7-R01「博愛の仏蘭西人形」effects[1]:
 * 「系統：「幻想」と「導魔」/「動玩」を持つ自分のスピリットすべては相手の効果でコアが
 * 1個より少なくならない。」
 *
 * effect_resistance(resistsOutcome:"core_below_min", coreMinimum:1) + tribesRequired(幻想)
 * + tribes(導魔/動玩, OR) の既存 primitive 組み合わせで表現 (BSTS01-R01 と同型)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
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

function makeCoreShootSource(amount: number): CardDefinition {
  return {
    cardNo: "SRC-CORESHOOT-R01",
    name: "コアシュート源",
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
              kind: "core_move",
              from: {
                kind: "field",
                player: "opponent",
                filter: { category: ["spirit"] },
              },
              to: { kind: "void", player: "opponent" },
              amount,
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

describe("BSTH02.7-R01 effects[1]: 幻想&(導魔/動玩) コア減少耐性 (core_below_min)", () => {
  const r01 = card("BSTH02.7-R01");
  const coreResistance = r01.effects![1]!;

  it("DSL 構造: effect_resistance(core_below_min, coreMinimum:1, tribesRequired:幻想, tribes:[導魔,動玩])", () => {
    expect(coreResistance.stub).toBeUndefined();
    const action = coreResistance.steps[0]!.action;
    expect(action.kind).toBe("effect_resistance");
    if (action.kind === "effect_resistance") {
      expect(action.resistsOutcome).toBe("core_below_min");
      expect(action.coreMinimum).toBe(1);
      expect(action.source).toBe("opponent_effect");
      if ("filter" in action.target) {
        expect(action.target.filter).toEqual({
          category: ["spirit"],
          tribesRequired: ["幻想"],
          tribes: ["導魔", "動玩"],
        });
      }
    }
  });

  it("[board] 相手のコアシュートでコア1個の対象はコアが残り0個にならない", () => {
    const src = makeCoreShootSource(2);
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [r01.cardNo, r01],
    ]);
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-bob",
          ownerPlayerId: "bob",
          zone: "field",
        }),
        createCardInstance(r01, {
          instanceId: "alice-r01",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
      "bob"
    );

    const result = executeEffect({
      chainId: "test:bsth02-7-r01-core-resistance:120",
      state,
      effect: src.effects![0]!,
      sourceInstanceId: "src-bob",
      actingPlayerId: "bob",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-r01"
    )!;
    expect(after.normalCoreCount).toBe(1);
  });

  it("[board] 系統不一致 (幻想/導魔/動玩を持たない) スピリットは耐性なくコアを奪われる", () => {
    const outsider: CardDefinition = {
      cardNo: "OUTSIDER-NO-TRIBE-MATCH",
      name: "無関係スピリット",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const src = makeCoreShootSource(2);
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [r01.cardNo, r01],
      [outsider.cardNo, outsider],
    ]);
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-bob",
          ownerPlayerId: "bob",
          zone: "field",
        }),
        createCardInstance(r01, {
          instanceId: "alice-r01",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(outsider, {
          instanceId: "alice-outsider",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
      "bob"
    );

    const result = executeEffect({
      chainId: "test:bsth02-7-r01-core-resistance:179",
      state,
      effect: src.effects![0]!,
      sourceInstanceId: "src-bob",
      actingPlayerId: "bob",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const protectedAfter = result.cardInstances.find(
      (c) => c.instanceId === "alice-r01"
    )!;
    const outsiderAfter = result.cardInstances.find(
      (c) => c.instanceId === "alice-outsider"
    )!;
    expect(protectedAfter.normalCoreCount).toBe(1);
    expect(outsiderAfter.normalCoreCount).toBe(0);
  });
});
