import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState } from "../src/model";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  executeRefSummon,
  executeSummonOther,
  executeSummonSelf,
} from "../src/effect/structured-summon";
import { placeCardFromZoneToField } from "../src/effect/structured-effect-interpreter";
import {
  collectAndQueueTriggerReactions,
  collectTriggerEventsFromStateDelta,
  getAvailableTriggeredEffectSourceChoices,
  queuePendingReactionsFromTriggerEvents,
} from "../src/effect/trigger-system";
import { finishCoreChoices } from "./helpers/core-choice-driver";
import { captureTriggerObservation } from "../src/effect/trigger-observation-sources";
import { executeBraveCombine } from "../src/legal/brave-combine-state-helpers";
import { moveCardZone } from "../src/core/core-system";
import { recordFieldEntry } from "../src/effect/semantic-trigger-events";
import { applyAbortPendingMultiPlacementAction } from "../src/legal/pending-action-handlers";

function definition(
  cardNo: string,
  effects: NonNullable<CardDefinition["effects"]>,
  category: "spirit" | "nexus" = "spirit"
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: category,
    cost: 0,
    colors: ["red"],
    reductionSymbols: [],
    symbolColors: ["red"],
    levelDefs: [
      { level: 1, requiredCores: category === "nexus" ? 0 : 1, bp: 1000 },
    ],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects,
  };
}

const reward: NonNullable<CardDefinition["effects"]>[number]["steps"] = [
  {
    action: {
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: { kind: "reserve", player: "self" },
      amount: 1,
    },
  },
];
const observer = definition("OBSERVER", [
  {
    timing: { kind: "game_event", event: "summon", player: "self" },
    steps: reward,
  },
]);
const target = definition("TARGET", [
  { timing: { kind: "card_event", event: "summon" }, steps: reward },
]);
const nexusObserver = definition(
  "NEXUS-OBSERVER",
  [
    {
      timing: { kind: "game_event", event: "place", player: "self" },
      steps: reward,
    },
  ],
  "nexus"
);
const nexusTarget = definition(
  "NEXUS-TARGET",
  [{ timing: { kind: "card_event", event: "place" }, steps: reward }],
  "nexus"
);
const definitions = [observer, target, nexusObserver, nexusTarget];
const lookup = (id: string) => definitions.find((card) => card.cardNo === id);
const dependencies = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(definitions),
};
function initial(nexuses = false): GameState {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      { reserveNormalCoreCount: 8, voidNormalCoreCount: 10 },
      {},
    ],
    cardInstances: [
      createCardInstance(nexuses ? nexusObserver : observer, {
        instanceId: "existing",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(nexuses ? nexusObserver : observer, {
        instanceId: "observer",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(nexuses ? nexusTarget : target, {
        instanceId: "target",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
    ],
  });
}
function summon(state: GameState, id: string): GameState {
  return executeSummonSelf(
    state,
    "entry-segment",
    "alice",
    { kind: "summon", target: "self", zone: "hand", withoutCost: true },
    id,
    lookup,
    [],
    [{ kind: "reserve_normal", amount: 1 }]
  );
}
function collect(beforeState: GameState, afterState: GameState) {
  return collectAndQueueTriggerReactions({
    beforeState,
    afterState,
    source: "action_resolution",
    chainId: "entry-segment",
    ...dependencies,
  });
}
function responders(state: GameState, relatedInstanceId?: string) {
  return state.pendingTriggeredEffects
    .filter(
      (pendingEffect) =>
        relatedInstanceId === undefined ||
        pendingEffect.relatedInstanceId === relatedInstanceId
    )
    .flatMap((pendingEffect) =>
      getAvailableTriggeredEffectSourceChoices({
        state,
        pendingEffect,
        ...dependencies,
      })
    )
    .map((choice) => choice.sourceCard.instanceId);
}

describe("field entry observes its operation's board, before deferred collection", () => {
  it("a later summoned observer cannot react to an earlier summon or its own summon (Q27796/Q9913)", () => {
    const before = initial();
    const after = collect(before, summon(summon(before, "target"), "observer"));
    expect(responders(after)).toContain("existing");
    expect(responders(after, "target")).toEqual(
      expect.arrayContaining(["target"])
    );
    expect(responders(after, "target")).not.toContain("observer");
    expect(responders(after, "observer")).not.toContain("observer");
  });

  it.each(["soul", "advent_source"] as const)(
    "%s returning to an independent spirit cannot observe an earlier summon",
    (role) => {
      const base = initial();
      const before: GameState = {
        ...base,
        players: base.players.map((player) =>
          player.id === "alice" && role === "soul"
            ? { ...player, soulStateInstanceIds: ["observer"] }
            : player
        ),
        cardInstances: base.cardInstances.map((card) =>
          card.instanceId === "observer"
            ? { ...card, zone: "field", normalCoreCount: 0 }
            : card.instanceId === "existing" && role === "advent_source"
              ? {
                  ...card,
                  underCards: [
                    { cardInstanceId: "observer", role: "advent_source" },
                  ],
                }
              : card
        ),
      };
      const summonedTarget = summon(before, "target");
      const returned = executeSummonSelf(
        summonedTarget,
        "entry-segment",
        "alice",
        { kind: "summon", target: "self", withoutCost: true },
        "observer",
        lookup,
        [],
        [{ kind: "reserve_normal", amount: 1 }]
      );
      const after = collect(before, returned);
      expect(
        after.cardInstances.find((card) => card.instanceId === "observer")
          ?.normalCoreCount
      ).toBe(1);
      expect(
        after.cardInstances.find((card) => card.instanceId === "observer")
          ?.triggerPresenceGeneration
      ).toBe(1);
      expect(responders(after, "target")).toContain("target");
      expect(responders(after, "target")).not.toContain("observer");
      expect(responders(after, "observer")).not.toContain("observer");
    }
  );

  it.each(["soul", "advent_source"] as const)(
    "%s returning before a later operation can observe the later summon",
    (role) => {
      const base = initial();
      const before: GameState = {
        ...base,
        players: base.players.map((player) =>
          player.id === "alice" && role === "soul"
            ? { ...player, soulStateInstanceIds: ["observer"] }
            : player
        ),
        cardInstances: base.cardInstances.map((card) =>
          card.instanceId === "observer"
            ? { ...card, zone: "field", normalCoreCount: 0 }
            : card.instanceId === "existing" && role === "advent_source"
              ? {
                  ...card,
                  underCards: [
                    { cardInstanceId: "observer", role: "advent_source" },
                  ],
                }
              : card
        ),
      };
      const returned = executeSummonSelf(
        before,
        "entry-segment",
        "alice",
        { kind: "summon", target: "self", withoutCost: true },
        "observer",
        lookup,
        [],
        [{ kind: "reserve_normal", amount: 1 }]
      );
      const after = collect(before, summon(returned, "target"));
      expect(responders(after, "target")).toContain("observer");
    }
  );

  it("an immediate self summon keeps the original hand origin through in_use", () => {
    const before = initial();
    const using: GameState = {
      ...before,
      cardInstances: before.cardInstances.map((card) =>
        card.instanceId === "target"
          ? { ...card, zone: "in_use", inUseSourceZone: "hand" }
          : card
      ),
    };
    const after = executeSummonSelf(
      using,
      "entry-segment",
      "alice",
      { kind: "summon", target: "self", zone: "hand", withoutCost: true },
      "target",
      lookup,
      [],
      [{ kind: "reserve_normal", amount: 1 }],
      undefined,
      "hand"
    );
    const event = collectTriggerEventsFromStateDelta({
      beforeState: using,
      afterState: after,
      source: "action_resolution",
      ...dependencies,
    }).find(
      (event) =>
        event.eventKind === "summon" && event.relatedInstanceId === "target"
    );
    expect(event?.fromZone).toBe("hand");
  });

  it("an observer already present before a later distinct operation can observe that later summon", () => {
    const before = initial();
    const after = collect(before, summon(summon(before, "observer"), "target"));
    expect(responders(after)).toContain("existing");
    expect(responders(after, "target")).toEqual(
      expect.arrayContaining(["observer", "target"])
    );
    expect(responders(after, "observer")).not.toContain("observer");
  });

  it.each(["other", "ref"] as const)(
    "%s simultaneous summons cannot observe siblings, including after maintenance core choices (Q28721)",
    (kind) => {
      const before = initial();
      const tentative =
        kind === "other"
          ? executeSummonOther(
              before,
              "entry-segment",
              "alice",
              {
                kind: "summon",
                target: "other",
                zone: "hand",
                count: 2,
                withoutCost: true,
              },
              "existing",
              lookup,
              undefined,
              undefined,
              ["observer", "target"]
            )
          : executeRefSummon(
              before,
              "alice",
              { kind: "summon", target: { kind: "ref", stepId: "picked" } },
              lookup,
              ["observer", "target"],
              "existing"
            );
      expect(tentative.pendingMultiPlacement).not.toBeNull();
      expect(
        collectTriggerEventsFromStateDelta({
          beforeState: before,
          afterState: tentative,
          source: "action_resolution",
          ...dependencies,
        }).filter((event) => event.eventKind === "summon")
      ).toEqual([]);
      const after = collect(
        before,
        finishCoreChoices(tentative, lookup, dependencies)
      );
      expect(responders(after)).toContain("existing");
      expect(responders(after, "target")).toEqual(
        expect.arrayContaining(["target"])
      );
      expect(responders(after, "target")).not.toContain("observer");
    }
  );

  it("a shared placement operation excludes its siblings while preserving their own placement effects (Q24617)", () => {
    const before = initial(true);
    let after = before;
    for (const id of ["observer", "target"])
      after = placeCardFromZoneToField(after, id, lookup, "place", before);
    after = collect(before, finishCoreChoices(after, lookup, dependencies));
    expect(responders(after)).toContain("existing");
    expect(responders(after, "target")).toEqual(
      expect.arrayContaining(["target"])
    );
    expect(responders(after, "target")).not.toContain("observer");
  });

  it("a provisional advent-source summon does not emit early, repeats its generation idempotently, and restores on abort", () => {
    const base = initial();
    const before: GameState = {
      ...base,
      cardInstances: base.cardInstances.map((card) =>
        card.instanceId === "observer"
          ? { ...card, zone: "field", normalCoreCount: 0 }
          : card.instanceId === "existing"
            ? {
                ...card,
                underCards: [
                  { cardInstanceId: "observer", role: "advent_source" },
                ],
              }
            : card
      ),
    };
    let tentative = executeSummonOther(
      before,
      "entry-segment",
      "alice",
      {
        kind: "summon",
        target: "other",
        zone: "hand",
        includeAdventSource: true,
        count: 2,
        withoutCost: true,
      },
      "existing",
      lookup,
      undefined,
      undefined,
      ["observer", "target"]
    );
    expect(tentative.pendingMultiPlacement?.canAbort).toBe(true);
    expect(
      tentative.cardInstances.find((card) => card.instanceId === "observer")
        ?.triggerPresenceGeneration
    ).toBe(1);
    tentative = recordFieldEntry(
      tentative,
      before,
      "observer",
      "summon",
      "field"
    );
    expect(
      tentative.cardInstances.find((card) => card.instanceId === "observer")
        ?.triggerPresenceGeneration
    ).toBe(1);
    expect(
      collectTriggerEventsFromStateDelta({
        beforeState: before,
        afterState: tentative,
        source: "action_resolution",
        ...dependencies,
      }).filter((event) => event.eventKind === "summon")
    ).toEqual([]);
    const restored = applyAbortPendingMultiPlacementAction({
      state: tentative,
      action: {
        kind: "abort_pending_multi_placement",
        actingPlayerId: "alice",
      },
      ...dependencies,
      getRegisteredBurstActions: () => [],
    }).state;
    expect(
      restored.cardInstances.find((card) => card.instanceId === "observer")
        ?.triggerPresenceGeneration ?? 0
    ).toBe(0);
    expect(
      restored.cardInstances.find((card) => card.instanceId === "existing")
        ?.underCards
    ).toEqual([{ cardInstanceId: "observer", role: "advent_source" }]);
    expect(restored.semanticTriggerEvents ?? []).toEqual([]);
  });

  it("an unaffordable soul-state summon keeps the original role and generation", () => {
    const base = initial();
    const before: GameState = {
      ...base,
      players: base.players.map((player) =>
        player.id === "alice"
          ? {
              ...player,
              reserveNormalCoreCount: 0,
              soulStateInstanceIds: ["observer"],
            }
          : player
      ),
      cardInstances: base.cardInstances.map((card) => ({
        ...card,
        normalCoreCount: 0,
        ...(card.instanceId === "observer" ? { zone: "field" as const } : {}),
      })),
    };
    const after = executeSummonSelf(
      before,
      "failed-entry",
      "alice",
      {
        kind: "summon",
        target: "self",
        overrideCost: 99,
      },
      "observer",
      lookup
    );
    expect(after.players[0]?.soulStateInstanceIds).toContain("observer");
    expect(
      after.cardInstances.find((card) => card.instanceId === "observer")
        ?.triggerPresenceGeneration ?? 0
    ).toBe(0);
    expect(after.semanticTriggerEvents ?? []).toEqual([]);
  });
});

describe("public trigger source identity before the observed event", () => {
  it.each(["trash", "set_aside"] as const)(
    "a late %s source cannot observe the earlier event",
    (zone) => {
      const publicObserver = definition(`PUBLIC-${zone}`, [
        {
          timing: { kind: "game_event", event: "summon", player: "self" },
          applicability: { zone },
          steps: reward,
        },
      ]);
      const defs = [publicObserver, target];
      const deps = {
        getCardDefinitionById: (id: string) =>
          defs.find((card) => card.cardNo === id),
        getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
        getRegisteredBurstActions: () => [],
      };
      const before = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(publicObserver, {
            instanceId: "observer",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(target, {
            instanceId: "target",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
      });
      const after = moveCardZone(before, "observer", zone);
      const observe = (atEvent: GameState) =>
        queuePendingReactionsFromTriggerEvents(
          after,
          [
            {
              eventKind: "summon",
              actingPlayerId: "alice",
              source: "action_resolution",
              chainId: "public-boundary",
              relatedInstanceId: "target",
              relatedPlayerId: "alice",
              attackId: null,
              amount: null,
              observationSnapshot: captureTriggerObservation(atEvent),
            },
          ],
          undefined,
          deps
        )
          .pendingTriggeredEffects.flatMap((pendingEffect) =>
            getAvailableTriggeredEffectSourceChoices({
              state: after,
              pendingEffect,
              ...deps,
            })
          )
          .map((choice) => choice.sourceCard.instanceId);
      expect(observe(before)).not.toContain("observer");
      expect(observe(after)).toContain("observer");
    }
  );

  it("a brave combined after the attack cannot inherit that past attack trigger", () => {
    const host = definition("ATTACK-HOST", []);
    const brave: CardDefinition = {
      ...definition("ATTACK-BRAVE", [
        {
          timing: { kind: "game_event", event: "attack", player: "self" },
          applicability: { combined: true },
          steps: reward,
          textRef: [0],
        },
      ]),
      printedCategory: "brave",
      textLines: [
        "【合体中】自分のスピリットがアタックしたとき、ボイドからコア1個を自分のリザーブに置く。",
      ],
    };
    const defs = [host, brave];
    const deps = {
      getCardDefinitionById: (id: string) =>
        defs.find((card) => card.cardNo === id),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
      getRegisteredBurstActions: () => [],
    };
    const before: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(host, {
            instanceId: "host",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(brave, {
            instanceId: "brave",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
      }),
      step: "attack",
    };
    const after = executeBraveCombine(
      before,
      "alice",
      "brave",
      "host",
      deps.getCardDefinitionById
    );
    expect(
      after.cardInstances.find((card) => card.instanceId === "brave")
        ?.attachedToInstanceId
    ).toBe("host");
    const observe = (atEvent: GameState) =>
      queuePendingReactionsFromTriggerEvents(
        after,
        [
          {
            eventKind: "attack",
            actingPlayerId: "alice",
            source: "action_resolution",
            chainId: "attack-boundary",
            relatedInstanceId: "host",
            relatedPlayerId: "alice",
            attackId: "attack",
            amount: null,
            observationSnapshot: captureTriggerObservation(atEvent),
          },
        ],
        undefined,
        deps
      )
        .pendingTriggeredEffects.flatMap((pendingEffect) =>
          getAvailableTriggeredEffectSourceChoices({
            state: after,
            pendingEffect,
            ...deps,
          })
        )
        .map((choice) => choice.sourceEffectInstanceId);
    expect(observe(before)).not.toContain("brave");
    expect(observe(after)).toContain("brave");
  });
});
