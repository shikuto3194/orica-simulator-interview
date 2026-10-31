/**
 * BSTH08.5-C20「能面・女（平静）」手元常駐効果:
 *  「手元にある系統：「面霊」を持つブレイヴカードすべてのシンボルは、フィールドに
 *   あるものとしても扱う。」
 *
 * 検証:
 *  - C20 が手元にある間、手元の系統:「面霊」ブレイヴカードの symbolColors が
 *    軽減シンボル供給源 (fieldSymbolSources) に追加され、軽減マッチに使える。
 *  - C20 が手元に無ければ、同じ手元カードは供給源に含まれない (通常通り無視)。
 *  - 手元にあっても系統:「面霊」を持たないブレイヴカードは供給源に含まれない。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  calculateReduction,
  buildTriggeredEffectLookup,
  buildBurstEffectLookup,
  getLegalActions,
  playSummonAsAction,
  getFieldSymbolSources,
  recomputeAndRebuildContinuousEffects,
  evaluateCondition,
  getCombinedUnitSymbolBundles,
  moveCardZone,
  sanitizeStateForViewer,
  createCardInstance,
  createEmptyGameState,
} from "../src";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const C20 = cardNoMap.get("BSTH08.5-C20")!;

function makeMenreiBrave(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `test ${cardNo}`,
    printedCategory: "brave",
    colors: ["red"],
    cost: 5,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
    symbolColors: ["red", "red"],
    textLines: [],
    keywordTags: [],
    tribe: "面霊",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

function makeOtherBrave(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `test ${cardNo}`,
    printedCategory: "brave",
    colors: ["red"],
    cost: 5,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
    symbolColors: ["red", "red"],
    textLines: [],
    keywordTags: [],
    tribe: "その他",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

function makeRedSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `test ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 5,
    reductionSymbols: ["red", "red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

const MENREI_BRAVE = makeMenreiBrave("TEST-MENREI-BRAVE-C20");
const OTHER_BRAVE = makeOtherBrave("TEST-OTHER-BRAVE-C20");
const RED_SPIRIT = makeRedSpirit("TEST-RED-SPIRIT-C20");

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id) ??
  [MENREI_BRAVE, OTHER_BRAVE, RED_SPIRIT].find((c) => c.cardNo === id);

function setup(options: {
  includeC20: boolean;
  setAsideBrave: CardDefinition;
}): GameState {
  const cardInstances = [
    createCardInstance(RED_SPIRIT, {
      instanceId: "alice-hand-spirit",
      ownerPlayerId: "alice",
      zone: "hand",
    }),
    createCardInstance(options.setAsideBrave, {
      instanceId: "alice-set-aside-brave",
      ownerPlayerId: "alice",
      zone: "set_aside",
    }),
  ];
  if (options.includeC20) {
    cardInstances.push(
      createCardInstance(C20, {
        instanceId: "alice-set-aside-c20",
        ownerPlayerId: "alice",
        zone: "set_aside",
      })
    );
  }
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances,
    playerOverrides: [
      { reserveNormalCoreCount: 5 },
      { reserveNormalCoreCount: 5 },
    ],
  });
  const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
  return rebuildContinuousEffectsFromField(state, getCardDefinitionById);
}

describe("BSTH08.5-C20「手元の系統:面霊ブレイヴのシンボルをフィールドにあるものとして扱う」", () => {
  it("C20が手元にある間、手元の面霊ブレイヴのシンボルが軽減供給源に加わる", () => {
    const state = setup({ includeC20: true, setAsideBrave: MENREI_BRAVE });
    const reduction = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: RED_SPIRIT,
      getCardDefinitionById,
      sourceInstanceId: "alice-hand-spirit",
    });
    expect(reduction.totalReduction).toBe(2);
    expect(reduction.finalCost).toBe(3);
    expect(
      reduction.fieldSymbolSources.some(
        (s) => s.sourceInstanceId === "alice-set-aside-brave"
      )
    ).toBe(true);
  });

  it("C20が手元に無ければ、同じ面霊ブレイヴは供給源に含まれない", () => {
    const state = setup({ includeC20: false, setAsideBrave: MENREI_BRAVE });
    const reduction = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: RED_SPIRIT,
      getCardDefinitionById,
      sourceInstanceId: "alice-hand-spirit",
    });
    expect(reduction.totalReduction).toBe(0);
    expect(reduction.finalCost).toBe(5);
    expect(
      reduction.fieldSymbolSources.some(
        (s) => s.sourceInstanceId === "alice-set-aside-brave"
      )
    ).toBe(false);
  });

  it("C20があっても系統:面霊を持たないブレイヴは供給源に含まれない (C20自身は面霊ブレイヴなので自己分のみ供給)", () => {
    const state = setup({ includeC20: true, setAsideBrave: OTHER_BRAVE });
    const reduction = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: RED_SPIRIT,
      getCardDefinitionById,
      sourceInstanceId: "alice-hand-spirit",
    });
    // C20 自身も系統:面霊のブレイヴのため、フィルタは C20 自身 (red×1) にはマッチする。
    // OTHER_BRAVE (系統:その他) だけが供給源から除外されることを確認する。
    expect(reduction.totalReduction).toBe(1);
    expect(reduction.finalCost).toBe(4);
    expect(
      reduction.fieldSymbolSources.some(
        (s) => s.sourceInstanceId === "alice-set-aside-brave"
      )
    ).toBe(false);
    expect(
      reduction.fieldSymbolSources.some(
        (s) => s.sourceInstanceId === "alice-set-aside-c20"
      )
    ).toBe(true);
  });
});

describe("field symbol extension audit", () => {
  const sources = (state: GameState, sourceInstanceId?: string) =>
    getFieldSymbolSources({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...(sourceInstanceId ? { sourceInstanceId } : {}),
    });
  it("複数C20は物理シンボルを増殖させない", () => {
    let state = setup({ includeC20: true, setAsideBrave: MENREI_BRAVE });
    state.cardInstances.push(
      createCardInstance(C20, {
        instanceId: "second-c20",
        ownerPlayerId: "alice",
        zone: "set_aside",
      })
    );
    state = rebuildContinuousEffectsFromField(state, getCardDefinitionById);
    const result = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: { ...RED_SPIRIT, cost: 8, reductionSymbols: Array(8).fill("red") },
      getCardDefinitionById,
    });
    expect(
      result.fieldSymbolSources.map((source) => source.sourceInstanceId)
    ).toEqual(["alice-set-aside-brave", "alice-set-aside-c20", "second-c20"]);
    expect(result.totalReduction).toBe(4);
    expect(result.finalCost).toBe(4);
    expect(
      state.cardInstances.filter((card) => card.zone === "set_aside")
    ).toHaveLength(3);
    expect(state.battleEntities).toEqual([]);
  });
  it("X01自身の支払い限定拡張は常時表示されず、C20と重なっても一度だけ供給", () => {
    const x01 = cardNoMap.get("BSTH08.5-X01")!;
    let state = setup({ includeC20: false, setAsideBrave: MENREI_BRAVE });
    state.cardInstances.push(
      createCardInstance(x01, {
        instanceId: "x01",
        ownerPlayerId: "alice",
        zone: "hand",
      })
    );
    state = recomputeAndRebuildContinuousEffects(state, getCardDefinitionById);
    expect(sources(state)).toEqual([]);
    expect(sources(state, "alice-hand-spirit")).toEqual([]);
    expect(
      sources(state, "x01").map((source) => source.sourceInstanceId)
    ).toEqual(["alice-set-aside-brave"]);
    state.cardInstances.push(
      createCardInstance(C20, {
        instanceId: "c20",
        ownerPlayerId: "alice",
        zone: "set_aside",
      })
    );
    state = rebuildContinuousEffectsFromField(state, getCardDefinitionById);
    expect(sources(state, "x01")).toHaveLength(2);
  });
  it("最後のC20が手元を離れると供給と場のシンボル存在参照が消える", () => {
    let state = setup({ includeC20: true, setAsideBrave: MENREI_BRAVE });
    expect(
      evaluateCondition(
        state,
        [
          {
            kind: "field_has",
            player: "self",
            symbolColors: ["red"],
            minCount: 1,
          },
        ],
        "",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        state,
        [{ kind: "field_lacks", player: "self", symbolColors: ["red"] }],
        "",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
    expect(
      evaluateCondition(
        state,
        [
          {
            kind: "field_has",
            player: "self",
            category: ["brave"],
            minCount: 1,
          },
        ],
        "",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
    expect(
      evaluateCondition(
        state,
        [
          {
            kind: "field_has",
            player: "self",
            category: ["brave"],
            symbolColors: ["red"],
            minCount: 1,
          },
        ],
        "",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
    state = moveCardZone(state, "alice-set-aside-c20", "trash");
    state = recomputeAndRebuildContinuousEffects(state, getCardDefinitionById);
    expect(sources(state)).toEqual([]);
    expect(
      evaluateCondition(
        state,
        [{ kind: "field_lacks", player: "self", symbolColors: ["red"] }],
        "",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
  });
  it("裏向き・相手・対象外系統は供給に入らず、除外指定を拡張にも適用する", () => {
    const state = setup({ includeC20: true, setAsideBrave: MENREI_BRAVE });
    state.cardInstances.push(
      createCardInstance(MENREI_BRAVE, {
        instanceId: "opponent",
        ownerPlayerId: "bob",
        zone: "set_aside",
      }),
      createCardInstance(MENREI_BRAVE, {
        instanceId: "hidden",
        ownerPlayerId: "alice",
        zone: "set_aside",
        faceDown: true,
      })
    );
    expect(sources(state)).toHaveLength(2);
    const excluded = getFieldSymbolSources({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      excludeFieldInstanceIds: ["alice-set-aside-brave"],
    });
    expect(excluded.map((source) => source.sourceInstanceId)).toEqual([
      "alice-set-aside-c20",
    ]);
    expect(sources(sanitizeStateForViewer(state, "bob"))).toHaveLength(2);
  });
  it("場の全シンボルを得る効果も拡張シンボルを参照する", () => {
    const star = cardNoMap.get("BSTH01-M13")!;
    let state = setup({ includeC20: true, setAsideBrave: MENREI_BRAVE });
    const instance = createCardInstance(star, {
      instanceId: "field-copy",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 5,
    });
    state.cardInstances.push(instance);
    state = rebuildContinuousEffectsFromField(state, getCardDefinitionById);
    expect(
      getCombinedUnitSymbolBundles(
        state,
        instance,
        star,
        getCardDefinitionById
      ).some((bundle) => bundle.colors.includes("red"))
    ).toBe(true);
  });
});

describe("BSTH08.5-X01の通常召喚元別の限定軽減", () => {
  it.each(["hand", "set_aside"] as const)(
    "%sからC20なしで合法に召喚し、手元の面霊シンボルで実支払いを軽減する",
    (zone) => {
      const x01 = cardNoMap.get("BSTH08.5-X01")!;
      const c21 = cardNoMap.get("BSTH08.5-C21")!;
      // 手元からはX01自身の赤も対象となる。維持コアを含めちょうど足りる量。
      const finalCost = zone === "hand" ? 6 : 5;
      const state = recomputeAndRebuildContinuousEffects(
        {
          ...createEmptyGameState({
            playerIds: ["alice", "bob"],
            playerOverrides: [{ reserveNormalCoreCount: finalCost + 1 }, {}],
            cardInstances: [
              createCardInstance(x01, {
                instanceId: "kokoro",
                ownerPlayerId: "alice",
                zone,
              }),
              createCardInstance(c21, {
                instanceId: "mask",
                ownerPlayerId: "alice",
                zone: "set_aside",
              }),
            ],
          }),
          step: "main",
          window: "main_step",
          activePlayerId: "alice",
        },
        getCardDefinitionById
      );
      expect(
        getFieldSymbolSources({
          state,
          actingPlayerId: "alice",
          getCardDefinitionById,
        })
      ).toEqual([]);
      expect(
        calculateReduction({
          state,
          actingPlayerId: "alice",
          card: x01,
          sourceInstanceId: "kokoro",
          getCardDefinitionById,
        }).finalCost
      ).toBe(finalCost);
      expect(
        getLegalActions({
          state,
          actingPlayerId: "alice",
          getCardDefinitionById,
        }).some(
          (action) =>
            action.kind === "summon" && action.sourceInstanceId === "kokoro"
        )
      ).toBe(true);
      const after = playSummonAsAction({
        state,
        actingPlayerId: "alice",
        cardInstanceId: "kokoro",
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(ALL_CARDS),
        getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
        paymentSources: [{ kind: "reserve", amount: finalCost }],
        enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
        getCardDefinitionById,
      }).state;
      expect(
        after.cardInstances.find((card) => card.instanceId === "kokoro")
      ).toMatchObject({ zone: "field", normalCoreCount: 1 });
      expect(
        after.cardInstances.find((card) => card.instanceId === "mask")?.zone
      ).toBe("set_aside");
      expect(
        after.players.find((player) => player.id === "alice")
          ?.reserveNormalCoreCount
      ).toBe(0);
      expect(
        after.players.find((player) => player.id === "alice")
          ?.trashNormalCoreCount
      ).toBe(finalCost);
    }
  );
});
