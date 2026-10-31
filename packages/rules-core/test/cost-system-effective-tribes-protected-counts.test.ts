/**
 * ENGINE-dynamic-count-protectedCounts-effective-tribes:
 * cost reduction 系の DynamicCount protectedCounts 可視性は、印字 tribe ではなく
 * source instance の実効系統 (`getEffectiveTribes`) で判定する。
 */
import { describe, expect, it } from "vitest";
import {
  calculateReduction,
  getEffectiveReductionSymbolEntries,
} from "../src/core/cost-system";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type {
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
} from "../src/model";

const ALICE = "alice";
const BOB = "bob";

function spiritDef(
  cardNo: string,
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    symbolColors: ["yellow"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "幻想",
    ...overrides,
  } as CardDefinition;
}

function addTribeCE(
  targetInstanceId: string,
  addTribe: string
): ContinuousEffect {
  return {
    effectId: `ce-add-tribe-${targetInstanceId}-${addTribe}`,
    sourceInstanceId: "ce-source",
    sourceDefinitionId: "CE-SOURCE",
    actingPlayerId: ALICE,
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "override_properties" as ContinuousEffectTag,
    targetInstanceId,
    metadata: { properties: { addTribes: [addTribe] } },
  };
}

describe("ENGINE-dynamic-count-protectedCounts-effective-tribes", () => {
  it("reduction waiver count_value sees protectedCounts when source gains the protected tribe", () => {
    const source = spiritDef("ENGINE-PROTECTED-WAIVER-SOURCE", {
      effects: [
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "treat_as",
                aspects: ["reduction_symbol"],
                whenPayingForFilter: { tribes: ["幻想"] },
                waivesReductionRequirement: true,
                count: { source: { kind: "count_value", player: "self" } },
              },
            },
          ],
        },
      ],
    });
    const payingFor = spiritDef("ENGINE-PROTECTED-WAIVER-PAY-TARGET", {
      cost: 7,
      reductionSymbols: ["red", "red", "red", "red", "red"],
    });
    const sourceCard = createCardInstance(source, {
      instanceId: "waiver-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [sourceCard],
      playerOverrides: [{ countValue: 5, protectedCounts: { 神喰: 3 } }, {}],
    });
    state.activeContinuousEffects = [addTribeCE(sourceCard.instanceId, "神喰")];
    const getDef = (id: string): CardDefinition | undefined =>
      id === source.cardNo
        ? source
        : id === payingFor.cardNo
          ? payingFor
          : undefined;

    const result = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: payingFor,
      getCardDefinitionById: getDef,
    });

    expect(result.totalReduction).toBe(5);
    expect(result.reducedCost).toBe(2);
  });

  it("reduction symbol dynamic count_value sees protectedCounts when source instance gains the protected tribe", () => {
    const inHand = spiritDef("ENGINE-PROTECTED-DYNAMIC-REDUCTION-SOURCE", {
      symbolColors: [],
      cost: 7,
      reductionSymbols: [],
      effects: [
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "treat_as",
                appliesToCard: true,
                aspects: ["reduction_symbol"],
                asColor: "red",
                addsReductionSymbol: true,
                count: { source: { kind: "count_value", player: "self" } },
              },
            },
          ],
        },
      ],
    });
    const handCard = createCardInstance(inHand, {
      instanceId: "dynamic-reduction-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [handCard],
      playerOverrides: [{ countValue: 5, protectedCounts: { 神喰: 3 } }, {}],
    });
    state.activeContinuousEffects = [addTribeCE(handCard.instanceId, "神喰")];
    const getDef = (id: string): CardDefinition | undefined =>
      id === inHand.cardNo ? inHand : undefined;

    const entries = getEffectiveReductionSymbolEntries(
      inHand,
      state,
      ALICE,
      getDef,
      handCard.instanceId,
      undefined
    );

    expect(entries).toHaveLength(5);
    expect(entries.every((entry) => entry.colors[0] === "red")).toBe(true);
  });
});
