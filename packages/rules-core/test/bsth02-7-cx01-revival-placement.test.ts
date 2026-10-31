import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition } from "../src";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { finalizeEffectResolution } from "../src/effect/effect-resolution";
import { collectTriggerEventsFromStateDelta } from "../src/effect/trigger-system";
import {
  checkAndQueuePlacementOracle,
  resolvePlacementOracleMechanic,
} from "../src/mechanics/oracle-system";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

function card(cardNo: string): CardDefinition {
  const definition = cardNoMap.get(cardNo);
  if (!definition) throw new Error(`card not found: ${cardNo}`);
  return definition;
}

const getDef = (definitionId: string): CardDefinition | undefined =>
  cardNoMap.get(definitionId);
const noTriggerLookup = () => [];

const ALICE = "player-1";

describe("BSTH02.7-CX01 【復活】", () => {
  it("配置時神託は同名在場ゲートなし + ターン1同名で定義されている", () => {
    const cx01 = card("BSTH02.7-CX01");
    expect(cx01.grandwalkerData?.oracleExecutionMode).toBe("optional");
    expect(cx01.grandwalkerData?.placementOracle).toEqual({
      sameNameGate: false,
      turnLimit: "per_card_name",
    });
  });

  it("BSTH02.7-CX01 は魂状態から配置して place event と配置時神託を発火する", () => {
    const cx01 = card("BSTH02.7-CX01");
    const revival = cx01.effects!.find(
      (effect) =>
        effect.steps.length > 0 && effect.steps[0]!.action.kind === "place"
    )!;
    const nexus = createCardInstance(cx01, {
      instanceId: "alice-revival-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const deckCard = createCardInstance(card("BSES01-C04"), {
      instanceId: "alice-deck-card",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const before = createEmptyGameState({
      cardInstances: [nexus, deckCard],
      playerOverrides: [{ soulStateInstanceIds: ["alice-revival-nexus"] }, {}],
    });

    const afterSteps = executeEffect({
      chainId: "test:bsth02-7-cx01-revival-placement:60",
      state: before,
      effect: revival,
      sourceInstanceId: "alice-revival-nexus",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    const aliceAfterSteps = afterSteps.players.find((p) => p.id === ALICE)!;
    expect(aliceAfterSteps.soulStateInstanceIds).not.toContain(
      "alice-revival-nexus"
    );

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: afterSteps,
      source: "action_resolution",
      chainId: "bsth02-7-cx01-revival",
      attackId: null,
      getCardDefinitionById: getDef,
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        eventKind: "place",
        relatedInstanceId: "alice-revival-nexus",
        fromZone: "field",
      })
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        eventKind: "summon",
        relatedInstanceId: "alice-revival-nexus",
      })
    );

    const finalized = finalizeEffectResolution({
      state: afterSteps,
      beforeState: before,
      chainId: "bsth02-7-cx01-revival",
      endLogs: [],
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: undefined,
      causedBySourceInstanceId: "alice-revival-nexus",
    });
    const placementOraclePendings = finalized.pendingTriggeredEffects.filter(
      (pending) =>
        pending.mechanic?.kind === "placement_oracle" &&
        pending.mechanic.grandwalkerInstanceId === "alice-revival-nexus"
    );
    expect(placementOraclePendings).toHaveLength(1);
  });

  it("配置時神託は別同名ネクサス在場だけでは止まらない", () => {
    const cx01 = card("BSTH02.7-CX01");
    const first = createCardInstance(cx01, {
      instanceId: "alice-first-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const second = createCardInstance(cx01, {
      instanceId: "alice-second-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const deckCard = createCardInstance(card("BSES01-C04"), {
      instanceId: "alice-deck-card",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const state = createEmptyGameState({
      cardInstances: [first, second, deckCard],
      playerOverrides: [{ deckCount: 1 }, {}],
    });

    const queued = checkAndQueuePlacementOracle(
      state,
      "alice-second-nexus",
      getDef,
      "test:bsth02-7-cx01-revival-placement:137"
    );
    expect(
      queued.pendingTriggeredEffects.filter(
        (pending) =>
          pending.mechanic?.kind === "placement_oracle" &&
          pending.mechanic.grandwalkerInstanceId === "alice-second-nexus"
      )
    ).toHaveLength(1);
  });

  it("配置時神託のターン1同名制限は通常配置と復活配置で共有される", () => {
    const cx01 = card("BSTH02.7-CX01");
    const revival = cx01.effects!.find(
      (effect) =>
        effect.steps.length > 0 && effect.steps[0]!.action.kind === "place"
    )!;
    const nexus = createCardInstance(cx01, {
      instanceId: "alice-revival-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const deckCards = Array.from({ length: 4 }, (_, index) =>
      createCardInstance(card("BSES01-C04"), {
        instanceId: `alice-deck-card-${index}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    let state = createEmptyGameState({
      cardInstances: [nexus, ...deckCards],
      playerOverrides: [{ deckCount: 4 }, {}],
    });

    state = checkAndQueuePlacementOracle(
      state,
      "alice-revival-nexus",
      getDef,
      "test:bsth02-7-cx01-revival-placement:174"
    );
    expect(
      state.pendingTriggeredEffects.filter(
        (pending) => pending.mechanic?.kind === "placement_oracle"
      )
    ).toHaveLength(1);
    state = resolvePlacementOracleMechanic(
      state,
      {
        kind: "placement_oracle",
        grandwalkerInstanceId: "alice-revival-nexus",
      },
      getDef
    );
    expect(
      state.effectUsageRecords.some(
        (record) =>
          record.sourceDefinitionId === cx01.cardNo &&
          record.effectLabel === "placement_oracle" &&
          record.duration === "turn"
      )
    ).toBe(true);

    const beforeRevival = {
      ...state,
      pendingTriggeredEffects: [],
      players: state.players.map((player) =>
        player.id === ALICE
          ? { ...player, soulStateInstanceIds: ["alice-revival-nexus"] }
          : player
      ),
    };
    const afterSteps = executeEffect({
      chainId: "test:bsth02-7-cx01-revival-placement:206",
      state: beforeRevival,
      effect: revival,
      sourceInstanceId: "alice-revival-nexus",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    const finalized = finalizeEffectResolution({
      state: afterSteps,
      beforeState: beforeRevival,
      chainId: "bsth02-7-cx01-revival-after-placement-oracle",
      endLogs: [],
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: undefined,
      causedBySourceInstanceId: "alice-revival-nexus",
    });
    expect(
      finalized.pendingTriggeredEffects.filter(
        (pending) =>
          pending.mechanic?.kind === "placement_oracle" &&
          pending.mechanic.grandwalkerInstanceId === "alice-revival-nexus"
      )
    ).toHaveLength(0);
  });
});
