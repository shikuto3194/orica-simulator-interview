import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { collectGameStateInvariantIssues } from "../src/invariants/game-state-invariants";
import { resolveStackCascade } from "../src/legal/stack-resolution-core";
import type { ActiveStack, CardDefinition, GameState } from "../src/model";

const ALICE = "alice";
const BOB = "bob";

const burstDef: CardDefinition = {
  cardNo: "TEST-BURST-SOURCE-MOVED",
  name: "Burst source moved",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  tribe: "test",
  sourceUrls: [],
  sourceConfidence: "C",
};

describe("burst activation whose source moved before effect declaration", () => {
  it("cancels the selected check and removes activation-window immunity", () => {
    const checkId = "burst-source-moved";
    const source = createCardInstance(burstDef, {
      instanceId: "burst-source",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source],
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      setBurstStates: [
        {
          playerId: BOB,
          cardInstanceId: source.instanceId,
        },
      ],
      pendingBurstChecks: [
        {
          checkId,
          actingPlayerId: BOB,
          eventKind: "attack_after",
          source: "battle_resolution",
          chainId: "test:burst-activation-source-moved:48",
          attackId: null,
          relatedPlayerId: ALICE,
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
          activationSelected: true,
        },
      ],
      revealedBurstStates: [
        {
          playerId: BOB,
          cardInstanceId: source.instanceId,
          checkId,
          activationPending: true,
        },
      ],
      activeContinuousEffects: [
        {
          effectId: `burst-window-immune-card:${checkId}`,
          sourceInstanceId: source.instanceId,
          sourceDefinitionId: burstDef.cardNo,
          actingPlayerId: BOB,
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: source.instanceId,
        },
        {
          effectId: `burst-window-immune-player:${checkId}`,
          sourceInstanceId: source.instanceId,
          sourceDefinitionId: burstDef.cardNo,
          actingPlayerId: BOB,
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "player_effect_immunity",
          targetInstanceId: BOB,
        },
      ],
    };
    const stack: ActiveStack = {
      stackId: "stack:burst-source-moved",
      actionKind: "burst_activation",
      chainId: `burst:${checkId}`,
      actingPlayerId: BOB,
      cardInstanceId: source.instanceId,
      cardDefinitionId: burstDef.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: [],
      burstCheckId: checkId,
      burstActivationSourceZone: "burst",
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };

    const after = resolveStackCascade(state, [stack], {
      getCardDefinitionById: (id) =>
        id === burstDef.cardNo ? burstDef : undefined,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });

    expect(after.pendingBurstChecks).toEqual([]);
    expect(after.setBurstStates).toEqual([]);
    expect(after.revealedBurstStates).toEqual([]);
    expect(
      after.activeContinuousEffects.filter((effect) =>
        effect.effectId.includes(checkId)
      )
    ).toEqual([]);
    expect(after.log).toContain(
      `burst:activation-cancelled:source-moved:${checkId}:${source.instanceId}`
    );
    expect(collectGameStateInvariantIssues(after)).toEqual([]);
  });
});
