/**
 * EDH-0004-01 regression: an external brave's card_event can create a
 * turn-duration CE on its host. That CE remains valid after the brave leaves.
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  collectContinuousEffectInvariantIssues,
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
} from "../src";
import type {
  CardDefinition,
  ContinuousEffect,
  GameStateInvariantIssue,
} from "../src";

const ALICE = "alice";
const BOB = "bob";

const targetDef: CardDefinition = {
  cardNo: "EDH-0004-TARGET",
  name: "EDH-0004 target",
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
};

const cardMap = new Map(
  [...ALL_CARDS, targetDef].map((definition) => [definition.cardNo, definition])
);
const getDef = (id: string): CardDefinition | undefined => cardMap.get(id);

function realCard(cardNo: string): CardDefinition {
  const definition = getDef(cardNo);
  if (!definition) throw new Error(`missing test card: ${cardNo}`);
  return definition;
}

describe("EDH-0004 external card_event duration CE invariant", () => {
  it("keeps BSES01-M03's turn CE valid after the attached brave leaves", () => {
    const host = createCardInstance(realCard("BSES01-T01"), {
      instanceId: "jagernote",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const brave = createCardInstance(realCard("BSES01-M03"), {
      instanceId: "ange",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    brave.attachedToInstanceId = host.instanceId;
    const target = createCardInstance(targetDef, {
      instanceId: "opponent-spirit",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, brave, target],
      }),
      getDef
    );
    const temporaryPreventBattle: ContinuousEffect = {
      effectId: "edh-0004-prevent-battle",
      sourceInstanceId: host.instanceId,
      sourceDefinitionId: host.definitionId,
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: base.turnNumber,
      createdAtAttackId: "attack-edh-0004",
      modifierTag: "prevent_battle_both",
      targetInstanceId: target.instanceId,
      provenance: {
        effectIndex: 2,
        stepIndex: 0,
        effectSourceInstanceId: brave.instanceId,
        effectSourceDefinitionId: brave.definitionId,
      },
    };
    const afterResolution = {
      ...base,
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        temporaryPreventBattle,
      ],
    };
    const afterBraveLeaves = {
      ...afterResolution,
      cardInstances: afterResolution.cardInstances.map((card) =>
        card.instanceId === brave.instanceId
          ? { ...card, zone: "trash", attachedToInstanceId: null }
          : card
      ),
    };

    for (const state of [afterResolution, afterBraveLeaves]) {
      const issues: GameStateInvariantIssue[] = [];
      collectContinuousEffectInvariantIssues({
        state,
        issues,
        getCardDefinitionById: getDef,
      });
      expect(issues).toEqual([]);
    }
  });
});
