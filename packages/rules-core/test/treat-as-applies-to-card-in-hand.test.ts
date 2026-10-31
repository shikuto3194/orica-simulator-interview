/**
 * P3-32: `treat_as { appliesToCard: true, aspects 含 reduction_symbol }` が
 * 召喚カード自身の軽減シンボルに作用するかを検証。
 *
 * 修正前: 手札ゾーンの continuous CE は未登録のため、`calculateReduction` の要求側 (= 召喚カードの
 * `reductionSymbols`) に treat_as が一切反映されず、軽減できなかった。
 *
 * 修正後: `calculateReduction` が `card.effects` を直接走査し、appliesToCard:true + reduction_symbol を
 * 含む treat_as 継続効果を要求側 entry に multi-color 化して bipartite matching で軽減を計算する。
 */
import { describe, expect, it } from "vitest";
import {
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const ALICE = "alice";
const BOB = "bob";

/** 軽減白×4 + treat_as red appliesToCard を持つテストカード (X05 を簡略化したもの)。 */
function whiteSpiritWithRedTreatAs(): CardDefinition {
  return {
    cardNo: "TEST-X05-LIKE",
    name: "白軽減 to 赤 テスト",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 6,
    reductionSymbols: ["white", "white", "white", "white"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 7000 }],
    symbolColors: ["white"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "test",
    effects: [
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol", "reduction_symbol"],
              asColor: "red",
              appliesToCard: true,
            },
          },
        ],
      },
    ],
  };
}

function redSymbolSupplier(): CardDefinition {
  return {
    cardNo: "TEST-RED-SUPPLY",
    name: "赤シンボル供給",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "test",
    effects: [],
  };
}

describe("P3-32: treat_as { appliesToCard: true, reduction_symbol } が手札カードに作用", () => {
  it("場の赤×4 で 軽減白×4 (treat_as red) を 4 軽減 → cost 6 → 2", () => {
    const x05 = whiteSpiritWithRedTreatAs();
    const supplier = redSymbolSupplier();

    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const fieldCards = Array.from({ length: 4 }).map((_, i) =>
      createCardInstance(supplier, {
        instanceId: `red-${i}`,
        ownerPlayerId: ALICE,
        zone: "field",
        cores: 1,
      })
    );
    const x05InHand = createCardInstance(x05, {
      instanceId: "x05-h",
      ownerPlayerId: ALICE,
      zone: "hand",
      cores: 0,
    });
    const state: GameState = {
      ...baseState,
      cardInstances: [...fieldCards, x05InHand],
    };

    const result = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: x05,
      sourceInstanceId: x05InHand.instanceId,
      getCardDefinitionById: (id) =>
        id === x05.cardNo ? x05 : id === supplier.cardNo ? supplier : undefined,
    });

    expect(result.totalReduction).toBe(4);
    expect(result.reducedCost).toBe(2);
    expect(result.finalCost).toBe(2);
  });

  it("場の白×2 + 赤×2 でも同じく 4 軽減 (片側使用ルールで 4 entries × 4 supply 全マッチ)", () => {
    const x05 = whiteSpiritWithRedTreatAs();
    const redSupplier = redSymbolSupplier();
    const whiteSupplier: CardDefinition = {
      ...redSupplier,
      cardNo: "TEST-WHITE-SUPPLY",
      colors: ["white"],
      symbolColors: ["white"],
    };

    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const cards = [
      ...Array.from({ length: 2 }).map((_, i) =>
        createCardInstance(redSupplier, {
          instanceId: `red-${i}`,
          ownerPlayerId: ALICE,
          zone: "field",
          cores: 1,
        })
      ),
      ...Array.from({ length: 2 }).map((_, i) =>
        createCardInstance(whiteSupplier, {
          instanceId: `white-${i}`,
          ownerPlayerId: ALICE,
          zone: "field",
          cores: 1,
        })
      ),
      createCardInstance(x05, {
        instanceId: "x05-h",
        ownerPlayerId: ALICE,
        zone: "hand",
        cores: 0,
      }),
    ];
    const state: GameState = { ...baseState, cardInstances: cards };

    const result = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: x05,
      sourceInstanceId: "x05-h",
      getCardDefinitionById: (id) =>
        id === x05.cardNo
          ? x05
          : id === redSupplier.cardNo
            ? redSupplier
            : id === whiteSupplier.cardNo
              ? whiteSupplier
              : undefined,
    });

    expect(result.totalReduction).toBe(4);
  });

  it("供給が紫のみ (treat_as 対象外色) なら 軽減 0", () => {
    const x05 = whiteSpiritWithRedTreatAs();
    const purpleSupplier: CardDefinition = {
      ...redSymbolSupplier(),
      cardNo: "TEST-PURPLE-SUPPLY",
      colors: ["purple"],
      symbolColors: ["purple"],
    };

    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const cards = [
      ...Array.from({ length: 4 }).map((_, i) =>
        createCardInstance(purpleSupplier, {
          instanceId: `purple-${i}`,
          ownerPlayerId: ALICE,
          zone: "field",
          cores: 1,
        })
      ),
      createCardInstance(x05, {
        instanceId: "x05-h",
        ownerPlayerId: ALICE,
        zone: "hand",
        cores: 0,
      }),
    ];
    const state: GameState = { ...baseState, cardInstances: cards };

    const result = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: x05,
      sourceInstanceId: "x05-h",
      getCardDefinitionById: (id) =>
        id === x05.cardNo
          ? x05
          : id === purpleSupplier.cardNo
            ? purpleSupplier
            : undefined,
    });

    expect(result.totalReduction).toBe(0);
    expect(result.reducedCost).toBe(6);
  });

  it("sourceInstanceId 省略時でも無条件 treat_as は適用される (X05 の treat_as は条件なし)", () => {
    const x05 = whiteSpiritWithRedTreatAs();
    const supplier = redSymbolSupplier();

    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const cards = [
      ...Array.from({ length: 4 }).map((_, i) =>
        createCardInstance(supplier, {
          instanceId: `red-${i}`,
          ownerPlayerId: ALICE,
          zone: "field",
          cores: 1,
        })
      ),
    ];
    const state: GameState = { ...baseState, cardInstances: cards };

    const result = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: x05,
      // sourceInstanceId 省略
      getCardDefinitionById: (id) =>
        id === x05.cardNo ? x05 : id === supplier.cardNo ? supplier : undefined,
    });

    // 無条件 treat_as は sourceInstanceId なしでも適用 → 4 軽減
    expect(result.totalReduction).toBe(4);
  });

  it("多色 treat_as [赤, 緑] reduction_symbol: 軽減白×2 が 場の赤1+緑1 で 2 軽減 (engine batch2-1)", () => {
    // 白軽減シンボルを「赤としても緑としても」扱う → 赤供給でも緑供給でも軽減できる。
    const multiDef: CardDefinition = {
      ...whiteSpiritWithRedTreatAs(),
      cardNo: "TEST-MULTI-REDUCTION",
      reductionSymbols: ["white", "white"],
      effects: [
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "treat_as",
                aspects: ["reduction_symbol"],
                asColor: ["red", "green"],
                appliesToCard: true,
              },
            },
          ],
        },
      ],
    };
    const redSupplier = redSymbolSupplier();
    const greenSupplier: CardDefinition = {
      ...redSupplier,
      cardNo: "TEST-GREEN-SUPPLY",
      colors: ["green"],
      symbolColors: ["green"],
    };

    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const cards = [
      createCardInstance(redSupplier, {
        instanceId: "red-0",
        ownerPlayerId: ALICE,
        zone: "field",
        cores: 1,
      }),
      createCardInstance(greenSupplier, {
        instanceId: "green-0",
        ownerPlayerId: ALICE,
        zone: "field",
        cores: 1,
      }),
      createCardInstance(multiDef, {
        instanceId: "multi-h",
        ownerPlayerId: ALICE,
        zone: "hand",
        cores: 0,
      }),
    ];
    const state: GameState = { ...baseState, cardInstances: cards };

    const result = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: multiDef,
      sourceInstanceId: "multi-h",
      getCardDefinitionById: (id) =>
        id === multiDef.cardNo
          ? multiDef
          : id === redSupplier.cardNo
            ? redSupplier
            : id === greenSupplier.cardNo
              ? greenSupplier
              : undefined,
    });

    // white 軽減2 entry が各 [white, red, green] 化 → 赤1 + 緑1 で両方マッチ = 2 軽減。
    // 多色のうち赤・緑の両方が機能している証拠 (単色なら片方しかマッチしない)。
    expect(result.totalReduction).toBe(2);
  });

  it("実カード BSTH01-X05 でも同様の軽減が成立する", async () => {
    const { ALL_CARDS } = await import("../../card-data/src/generated-index");
    const x05 = ALL_CARDS.find((c) => c.cardNo === "BSTH01-X05");
    expect(x05).toBeDefined();
    const supplier = redSymbolSupplier();

    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const cards = [
      ...Array.from({ length: 4 }).map((_, i) =>
        createCardInstance(supplier, {
          instanceId: `red-${i}`,
          ownerPlayerId: ALICE,
          zone: "field",
          cores: 1,
        })
      ),
      createCardInstance(x05!, {
        instanceId: "x05-h",
        ownerPlayerId: ALICE,
        zone: "hand",
        cores: 0,
      }),
    ];
    const state: GameState = { ...baseState, cardInstances: cards };

    const result = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: x05!,
      sourceInstanceId: "x05-h",
      getCardDefinitionById: (id) =>
        id === x05!.cardNo
          ? x05!
          : id === supplier.cardNo
            ? supplier
            : undefined,
    });

    // X05: cost 6 / 軽減白×4 / treat_as red appliesToCard
    expect(result.totalReduction).toBe(4);
    expect(result.reducedCost).toBe(2);
  });
});
