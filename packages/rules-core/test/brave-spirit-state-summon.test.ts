/**
 * ブレイヴ / アルティメットの手札召喚 (スピリット状態) validation 回帰テスト
 *
 * 背景: `getHandCardLegalActionKind` は spirit / ultimate / brave をすべて
 * "summon" 合法手として提示するが、`getHandCardAndDefinition` の
 * expectedCategory が "spirit" 固定だったため、apply 時に
 * "Card category does not match action: expected=spirit actual=brave" で
 * silent failure していた。expectedCategories を spirit/ultimate/brave 許可へ
 * 拡張した修正の回帰ガード。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../src/model";
import { playSummonAsAction, placeNexusAsAction } from "../src/index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { createCardInstance, createEmptyGameState } from "../src/factories";

function makeCard(
  cardNo: string,
  printedCategory: CardDefinition["printedCategory"],
  cost = 2
): CardDefinition {
  return {
    cardNo,
    name: `Card ${cardNo}`,
    printedCategory,
    colors: ["red"],
    cost,
    reductionSymbols: [],
    levelDefs:
      printedCategory === "nexus"
        ? [{ level: 1, requiredCores: 0, bp: 0 }]
        : [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

function createLookup(defs: CardDefinition[]) {
  const map = new Map(defs.map((d) => [d.cardNo, d]));
  return (id: string) => map.get(id);
}

function setup(def: CardDefinition) {
  const baseState = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(def, {
        instanceId: "hand-card",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
    ],
    playerOverrides: [{ reserveNormalCoreCount: 3 }],
  });
  return {
    state: { ...baseState, step: "main" as const, activePlayerId: "alice" },
    lookup: createLookup([def]),
    triggeredLookup: buildTriggeredEffectLookup([def]),
  };
}

describe("ブレイヴ / アルティメット スピリット状態召喚 validation", () => {
  it("ブレイヴをスピリット状態で召喚するとフィールドに置かれ category=brave を保つ", () => {
    const def = makeCard("BRAVE-SUMMON", "brave");
    const { state, lookup, triggeredLookup } = setup(def);

    const result = playSummonAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "hand-card",
      paymentSources: [{ kind: "reserve", amount: 2 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    const card = result.state.cardInstances.find(
      (c) => c.instanceId === "hand-card"
    );
    expect(card?.zone).toBe("field");
    // スピリット状態 (未合体) で置かれる
    expect(card?.attachedToInstanceId).toBeNull();
    expect(lookup(card!.definitionId)?.printedCategory).toBe("brave");
  });

  it("アルティメットを手札から召喚できる", () => {
    const def = makeCard("ULT-SUMMON", "ultimate");
    const { state, lookup, triggeredLookup } = setup(def);

    const result = playSummonAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "hand-card",
      paymentSources: [{ kind: "reserve", amount: 2 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    const card = result.state.cardInstances.find(
      (c) => c.instanceId === "hand-card"
    );
    expect(card?.zone).toBe("field");
  });

  it("マジックを playSummonAsAction に渡すと category 不一致で throw する", () => {
    const def = makeCard("MAGIC-SUMMON", "magic");
    const { state, lookup, triggeredLookup } = setup(def);

    expect(() =>
      playSummonAsAction({
        state,
        actingPlayerId: "alice",
        cardInstanceId: "hand-card",
        paymentSources: [{ kind: "reserve", amount: 2 }],
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      })
    ).toThrow(/Card category does not match action/);
  });

  it("ブレイヴを placeNexusAsAction に渡すと category 不一致で throw する", () => {
    const def = makeCard("BRAVE-AS-NEXUS", "brave");
    const { state, lookup, triggeredLookup } = setup(def);

    expect(() =>
      placeNexusAsAction({
        state,
        actingPlayerId: "alice",
        cardInstanceId: "hand-card",
        paymentSources: [{ kind: "reserve", amount: 2 }],
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      })
    ).toThrow(/Card category does not match action/);
  });
});
