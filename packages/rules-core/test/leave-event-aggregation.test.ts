import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState } from "../src/model";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { queuePendingLeave } from "../src/state-based-actions";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  collectAndQueueTriggerReactions,
  flushPendingLeavesAndQueueReactions,
  getAvailableTriggeredEffectSourceChoices,
  queuePendingReactionsFromTriggerEvents,
} from "../src/effect/trigger-system";
import type { CollectedTriggerEvent } from "../src/effect/trigger-system";

function setup(
  eventKind:
    | "destroy"
    | "vanish"
    | "bounce"
    | "remove_from_game"
    | "leave_field" = "vanish"
) {
  const base: CardDefinition = {
    cardNo: "target",
    name: "Target",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    symbolColors: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
  const definitions: CardDefinition[] = [
    base,
    {
      ...base,
      cardNo: "watcher",
      effects: [
        {
          timing: {
            kind: "game_event",
            event: eventKind === "bounce" ? "leave_field" : eventKind,
            player: "self",
          },
          steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
        },
      ],
    },
  ];
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: ["watcher-a", "watcher-b", "target-a", "target-b"].map(
      (instanceId) =>
        createCardInstance(
          instanceId.startsWith("watcher") ? definitions[1]! : base,
          {
            instanceId,
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }
        )
    ),
  });
  const events: CollectedTriggerEvent[] = ["target-a", "target-b"].map(
    (relatedInstanceId) => ({
      eventKind,
      actingPlayerId: "alice",
      source: "action_resolution",
      chainId: "same-effect",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId,
      amount: null,
      cause: "opponent_effect",
      effectSourceInstanceId: "removal-source",
    })
  );
  const lookups = {
    getCardDefinitionById: (id: string) =>
      definitions.find((def) => def.cardNo === id),
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
    getRegisteredBurstActions: undefined,
  };
  const choices = (queued: GameState) =>
    queued.pendingTriggeredEffects.flatMap((pendingEffect) =>
      getAvailableTriggeredEffectSourceChoices({
        state: queued,
        pendingEffect,
        ...lookups,
      })
    );
  return { state, events, lookups, definitions, choices };
}

describe("同一効果による同時離場の誘発集約", () => {
  it.each([
    "destroy",
    "vanish",
    "bounce",
    "remove_from_game",
    "leave_field",
  ] as const)(
    "%s: 回数制限のない第三者効果も各ソース1回、関連対象2体を保持する",
    (kind) => {
      const { state, events, lookups, choices } = setup(kind);
      const queued = queuePendingReactionsFromTriggerEvents(
        state,
        events,
        undefined,
        lookups
      );
      expect(
        choices(queued)
          .map((choice) => choice.sourceCard.instanceId)
          .sort()
      ).toEqual(["watcher-a", "watcher-b"]);
      expect(queued.pendingTriggeredEffects).toHaveLength(1);
      expect(
        queued.pendingTriggeredEffects[0]!.relatedInstanceIds?.sort()
      ).toEqual(["target-a", "target-b"]);
    }
  );

  it.each(["different-effect", "same-effect:after_triggers:1"])(
    "別の解決境界 %s では各ソースが再度誘発する",
    (chainId) => {
      const { state, events, lookups, choices } = setup();
      events[1] = { ...events[1]!, chainId };
      const queued = queuePendingReactionsFromTriggerEvents(
        state,
        events,
        undefined,
        lookups
      );
      expect(
        choices(queued)
          .map((choice) => choice.sourceCard.instanceId)
          .sort()
      ).toEqual(["watcher-a", "watcher-a", "watcher-b", "watcher-b"]);
    }
  );

  it("2体自身の破壊時効果はそれぞれ残す", () => {
    const { state, events, definitions, lookups } = setup("destroy");
    definitions[0]!.effects = [
      {
        timing: { kind: "card_event", event: "destroy" },
        steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      },
    ];
    const updatedLookups = {
      ...lookups,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
    };
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      events,
      undefined,
      updatedLookups
    );
    const sources = queued.pendingTriggeredEffects.flatMap((pendingEffect) =>
      getAvailableTriggeredEffectSourceChoices({
        state: queued,
        pendingEffect,
        ...updatedLookups,
      }).map((choice) => choice.sourceCard.instanceId)
    );
    expect(sources.sort()).toEqual([
      "target-a",
      "target-b",
      "watcher-a",
      "watcher-b",
    ]);
  });

  it("先頭対象が条件外でも後続対象から誘発する", () => {
    const { state, events, definitions, lookups } = setup();
    definitions[1]!.effects![0]!.timing = {
      kind: "game_event",
      event: "vanish",
      player: "self",
      triggerFilter: { colors: ["purple"] },
    };
    definitions.push({
      ...definitions[0]!,
      cardNo: "purple-target",
      colors: ["purple"],
    });
    state.cardInstances.find(
      (card) => card.instanceId === "target-b"
    )!.definitionId = "purple-target";
    const updatedLookups = {
      ...lookups,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
    };
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      events,
      undefined,
      updatedLookups
    );
    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    expect(queued.pendingTriggeredEffects[0]!.relatedInstanceId).toBe(
      "target-b"
    );
  });

  it("待機入りで集約した離場時効果を、後続対象の実離場で再誘発しない", () => {
    const { state, lookups } = setup("leave_field");
    const afterCoreRemoval: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId.startsWith("target")
          ? { ...card, normalCoreCount: 0 }
          : card
      ),
    };
    const afterState = ["target-a", "target-b"].reduce(
      (current, instanceId) =>
        queuePendingLeave({
          state: current,
          instanceId,
          kind: "vanish",
          cause: "effect_resolution",
          chainId: "same-effect",
          causePlayerId: "bob",
          causedByEffectSourceInstanceId: "removal-source",
        }),
      afterCoreRemoval
    );
    const queued = collectAndQueueTriggerReactions({
      beforeState: state,
      afterState,
      source: "action_resolution",
      chainId: "same-effect",
      attackId: null,
      ...lookups,
    });
    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    // 誘発を消化した後の実離場を再現。消化済み情報は各離場intentに残る必要がある。
    const flushed = flushPendingLeavesAndQueueReactions({
      beforeFlushState: {
        ...queued,
        pendingTriggeredEffects: [],
        pendingBurstChecks: [],
      },
      chainId: "same-effect",
      ...lookups,
    });
    expect(
      flushed.cardInstances
        .filter((card) => card.instanceId.startsWith("target"))
        .map((card) => card.zone)
    ).toEqual(["trash", "trash"]);
    expect(flushed.pendingTriggeredEffects).toHaveLength(0);
  });
});
