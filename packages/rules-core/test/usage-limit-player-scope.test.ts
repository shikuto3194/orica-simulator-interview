import { describe, expect, it } from "vitest";
import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type CardDefinition,
  type GameState,
  type PendingTriggeredEffect,
} from "../src";
import { canUseEffectByUsageLimit } from "../src/legal/legal-actions-shared";

const responderNexus: CardDefinition = {
  cardNo: "TEST-SAME-NAME-NEXUS",
  name: "Same Name Nexus",
  printedCategory: "nexus",
  colors: ["red"],
  cost: 5,
  reductionSymbols: [],
  levelDefs: [
    { level: 1, requiredCores: 0, bp: 0 },
    { level: 2, requiredCores: 1, bp: 0 },
  ],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "game_event", player: "self", event: "summon" },
      applicability: { level: { min: 2 } },
      executionMode: "optional",
      usageLimit: { kind: "per_card_name", duration: "turn" },
      steps: [
        {
          action: { kind: "life_fill", player: "self", targetValue: 5 },
        },
      ],
    },
  ],
};

const summonedSpirit: CardDefinition = {
  cardNo: "TEST-SUMMONED-SPIRIT",
  name: "Summoned Spirit",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 8,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 8000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const definitions = [responderNexus, summonedSpirit];
const getDefinition = (id: string): CardDefinition | undefined =>
  definitions.find((definition) => definition.cardNo === id);
const triggeredLookup = buildTriggeredEffectLookup(definitions);

function buildPendingState(): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [{ lifeNormalCoreCount: 2, voidNormalCoreCount: 188 }, {}],
    cardInstances: [
      createCardInstance(responderNexus, {
        instanceId: "alice-nexus",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(responderNexus, {
        instanceId: "bob-nexus",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(summonedSpirit, {
        instanceId: "alice-summoned",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
    ],
  });
  const pending: PendingTriggeredEffect = {
    pendingId: "pending-summon-alice",
    actingPlayerId: "alice",
    eventKind: "summon",
    event: {
      family: "enter_field",
      actionKind: "summon",
      validationMode: "require_related_instance_on_field",
    },
    source: "action_resolution",
    chainId: "test:usage-limit-player-scope:89",
    attackId: null,
    relatedPlayerId: "alice",
    relatedInstanceId: "alice-summoned",
    amount: null,
    step: "attack",
    window: "none",
    resolvedSourceInstanceIds: [],
  };

  return {
    ...base,
    activePlayerId: "bob",
    step: "attack",
    window: "none",
    turnNumber: 7,
    pendingTriggeredEffects: [pending],
    effectUsageRecords: [
      {
        sourceInstanceId: "bob-nexus",
        sourceDefinitionId: responderNexus.cardNo,
        effectLabel: "effect:0",
        turnNumber: 7,
        step: "main",
        duration: "turn",
        count: 1,
      },
    ],
  };
}

describe("same-name usage limits are scoped per player", () => {
  it("does not let an opponent's same-name record block the current source", () => {
    const state = buildPendingState();

    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "alice-nexus",
        sourceDefinitionId: responderNexus.cardNo,
        effectLabel: "effect:0",
        usageLimit: { kind: "per_card_name", duration: "turn" },
      })
    ).toBe(true);

    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "bob-nexus",
        sourceDefinitionId: responderNexus.cardNo,
        effectLabel: "effect:0",
        usageLimit: { kind: "per_card_name", duration: "turn" },
      })
    ).toBe(false);
  });

  it("still exposes the owner's pending triggered resolve action", () => {
    const state = buildPendingState();

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    expect(
      actions.find(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceInstanceId === "alice-nexus"
      )
    ).toMatchObject({
      kind: "resolve_pending_triggered_effect",
      actingPlayerId: "alice",
      sourceInstanceId: "alice-nexus",
      executionMode: "optional",
      targetMode: "none",
    });
  });
  it("keeps a consumed game-scope same-name effect out of legal actions", () => {
    const before = buildPendingState();
    const state: GameState = {
      ...before,
      turnNumber: 8,
      effectUsageRecords: [
        {
          ...before.effectUsageRecords[0]!,
          sourceInstanceId: "alice-nexus",
          duration: "game",
          turnNumber: 1,
        },
      ],
    };

    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "alice-nexus",
        sourceDefinitionId: responderNexus.cardNo,
        effectLabel: "effect:0",
        usageLimit: { kind: "per_card_name", duration: "game" },
      })
    ).toBe(false);

    const gameScopedResponder: CardDefinition = {
      ...responderNexus,
      effects: responderNexus.effects?.map((effect) => ({
        ...effect,
        usageLimit: { kind: "per_card_name", duration: "game" },
      })),
    };
    const getGameScopedDefinition = (id: string) =>
      id === gameScopedResponder.cardNo ? gameScopedResponder : undefined;
    const gameScopedLookup = buildTriggeredEffectLookup([
      gameScopedResponder,
      summonedSpirit,
    ]);

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getGameScopedDefinition,
      getRegisteredTriggeredEffectActions: gameScopedLookup,
    });
    expect(
      actions.some(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceInstanceId === "alice-nexus" &&
          action.skipOnly !== true
      )
    ).toBe(false);
    expect(
      actions.find(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceInstanceId === "alice-nexus"
      )
    ).toMatchObject({ skipOnly: true });
  });
});
