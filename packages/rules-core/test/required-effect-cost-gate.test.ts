import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import {
  canPayRequiredEffectCosts,
  type RequiredEffectCostFilterOptions,
} from "../src/legal/required-effect-cost-gate";
import type { CardFilter } from "../src/dsl-types";
import type { CardDefinition } from "../src/model";

const ALICE = "alice";
const BOB = "bob";

const SPIRIT_DEF: CardDefinition = {
  cardNo: "TEST-REQUIRED-COST-SPIRIT",
  name: "required cost source spirit",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 3,
  reductionSymbols: ["purple"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const CONDITIONAL_EVENT_SOURCE_DEF: CardDefinition = {
  ...SPIRIT_DEF,
  cardNo: "TEST-REQUIRED-COST-CONDITIONAL-EVENT-SOURCE",
  name: "conditional event core source",
  textLines: [
    "Lv1『このスピリットのアタック時』",
    "このスピリットを回復する。",
  ],
  effects: [
    {
      timing: { kind: "card_event", event: "attack" },
      textRef: [0, 1],
      condition: [{ kind: "min_level", value: 2 }],
      steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
    },
  ],
};

const defs = new Map<string, CardDefinition>([
  [SPIRIT_DEF.cardNo, SPIRIT_DEF],
  [CONDITIONAL_EVENT_SOURCE_DEF.cardNo, CONDITIONAL_EVENT_SOURCE_DEF],
]);
const getDef = (definitionId: string): CardDefinition | undefined =>
  defs.get(definitionId);

function canPayCoreMoveFromField(
  state = soulStateOnlyState(),
  sourceFilter: CardFilter = {},
  filterOptions: RequiredEffectCostFilterOptions = {}
): boolean {
  return canPayRequiredEffectCosts(
    state,
    ALICE,
    {
      requiredCoreMoveCost: {
        sourcePlayer: "self",
        sourceFilter,
        destination: { kind: "reserve", player: "self" },
        amount: 1,
      },
    },
    getDef,
    [],
    filterOptions
  );
}

function soulStateOnlyState() {
  const soulStateSource = createCardInstance(SPIRIT_DEF, {
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    instanceId: "soul-state-source",
    normalCoreCount: 2,
  });
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [soulStateSource],
    playerOverrides: [{ soulStateInstanceIds: ["soul-state-source"] }, {}],
  });
}

describe("required effect core move cost gate", () => {
  it("generic sourceFilter excludes soul-state cards through the core source SSOT", () => {
    expect(canPayCoreMoveFromField()).toBe(false);
    expect(
      canPayCoreMoveFromField(soulStateOnlyState(), { soulState: "include" })
    ).toBe(true);

    const normalSource = createCardInstance(SPIRIT_DEF, {
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      instanceId: "normal-source",
      normalCoreCount: 1,
    });
    const baseState = soulStateOnlyState();
    const stateWithNormalSource = {
      ...baseState,
      cardInstances: [...baseState.cardInstances, normalSource],
    };

    expect(canPayCoreMoveFromField(stateWithNormalSource)).toBe(true);
  });

  it("passes CardFilter evaluators to conditional card_event source filters", () => {
    const conditionalSource = createCardInstance(CONDITIONAL_EVENT_SOURCE_DEF, {
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      instanceId: "conditional-event-source",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [conditionalSource],
    });
    const sourceFilter: CardFilter = { hasCardEventEffect: ["attack"] };
    const evaluated: string[] = [];

    expect(canPayCoreMoveFromField(state, sourceFilter)).toBe(false);
    expect(
      canPayCoreMoveFromField(state, sourceFilter, {
        evaluateCondition: (_condition, sourceId, actingPlayerId) => {
          evaluated.push(`${sourceId}:${actingPlayerId}`);
          return true;
        },
      })
    ).toBe(true);
    expect(evaluated).toEqual(["conditional-event-source:alice"]);
  });
});
