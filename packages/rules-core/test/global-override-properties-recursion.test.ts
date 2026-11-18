import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { getEffectiveTribes } from "../src/legal/legal-actions-shared";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src/model";

const ALICE = "alice";
const BOB = "bob";

const TEST_SPIRIT: CardDefinition = {
  cardNo: "ENGINE-RECURSION-SPIRIT",
  name: "Recursion Guard Spirit",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: ["red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  tribe: "紅魔",
  sourceUrls: [],
  sourceConfidence: "A",
} as CardDefinition;

const TEST_NEXUS: CardDefinition = {
  cardNo: "ENGINE-RECURSION-NEXUS",
  name: "Recursion Guard Nexus",
  printedCategory: "nexus",
  colors: ["yellow"],
  cost: 4,
  reductionSymbols: ["yellow"],
  levelDefs: [{ level: 1, requiredCores: 0 }],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "A",
} as CardDefinition;

function getCardDef(id: string): CardDefinition | undefined {
  if (id === TEST_SPIRIT.cardNo) return TEST_SPIRIT;
  if (id === TEST_NEXUS.cardNo) return TEST_NEXUS;
  return undefined;
}

function fieldSpirit(
  instanceId: string,
  controllerPlayerId: string
): CardInstance {
  return createCardInstance(TEST_SPIRIT, {
    instanceId,
    ownerPlayerId: controllerPlayerId,
    controllerPlayerId,
    zone: "field",
    normalCoreCount: 1,
  });
}

function makeState(cards: readonly CardInstance[]): GameState {
  return {
    ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
    cardInstances: [...cards],
  };
}

describe("global override_properties recursion guard", () => {
  it("global addTribes immunity gate evaluates global filter CE without re-entering global overrides", () => {
    const target = fieldSpirit("alice-target", ALICE);
    const source = fieldSpirit("bob-source", BOB);
    const activeContinuousEffects: ContinuousEffect[] = [
      {
        effectId: "ce-global-defense-immune",
        sourceInstanceId: "alice-lock-source",
        sourceDefinitionId: TEST_NEXUS.cardNo,
        actingPlayerId: ALICE,
        duration: { scope: "permanent" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "defense_immune" as ContinuousEffectTag,
        targetFilter: {
          player: "self",
          category: ["spirit"],
        },
        metadata: { source: "opponent_effect" },
      },
      {
        effectId: "ce-global-add-tribe",
        sourceInstanceId: source.instanceId,
        sourceDefinitionId: TEST_SPIRIT.cardNo,
        actingPlayerId: BOB,
        duration: { scope: "while_on_field" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "override_properties" as ContinuousEffectTag,
        targetFilter: {
          player: "opponent",
          category: ["spirit"],
        },
        metadata: { properties: { addTribes: ["対象"] } },
      },
    ];
    const state: GameState = {
      ...makeState([target, source]),
      activeContinuousEffects,
    };

    expect(getEffectiveTribes(state, target, TEST_SPIRIT, getCardDef)).toEqual([
      "紅魔",
    ]);
  });
});
