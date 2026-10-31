/**
 * P3-04 テストカバレッジ拡充: trigger-system のユニットテスト。
 *
 * matchesTriggerEvent, triggerEventKindToStructuredEvent,
 * getTriggeredEffectSourceUseBlockReason, getSimultaneousGroups,
 * collectTriggerEventsFromStateDelta をテスト。
 */
import { describe, expect, it } from "vitest";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  GameState,
  PendingTriggeredEffect,
  StructuredTriggerEvent,
} from "../src/model";
import {
  matchesTriggerEvent,
  triggerEventKindToStructuredEvent,
  burstEventKindToStructuredEvent,
  getTriggeredEffectSourceUseBlockReason,
  getSimultaneousGroups,
  collectTriggerEventsFromStateDelta,
  collectAndQueueTriggerReactions,
  queuePendingReactionsRawForTesting,
  queuePendingReactionsFromTriggerEvents,
  getAvailableTriggeredEffectSourceChoices,
  useResolvePendingTriggeredEffectAsAction,
} from "../src/effect/trigger-system";
import {
  buildBurstEffectLookup,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import type { TriggerEventMatcher } from "../src/effect/trigger-system";
import type { CardFilter } from "../src/dsl-types";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { applyLegalAction, executeEffect, getLegalActions } from "../src";
import type { LegalAction } from "../src";
import { resumeStackCascadeIfReady } from "../src/legal/stack-resolution-core";
import { maskPendingPromptsForViewer } from "../src/state-sanitize";
import { runActionMainResolution } from "../src/effect/effect-resolution";

// --- Helpers ---

function makeDef(
  cardNo: string,
  category: "spirit" | "magic" | "nexus" = "spirit"
): CardDefinition {
  return {
    cardNo,
    name: `Test ${cardNo}`,
    printedCategory: category,
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C" as const,
  };
}

function makeLookup(definitions: readonly CardDefinition[]) {
  const map = new Map(definitions.map((def) => [def.cardNo, def]));
  return (definitionId: string) => map.get(definitionId);
}

function makeOpponentSummonBurstDef(cardNo: string): CardDefinition {
  return {
    ...makeDef(cardNo, "spirit"),
    keywordTags: ["burst"],
    effects: [
      {
        timing: { kind: "burst", trigger: { kind: "opponent_summon" } },
        steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      },
    ],
  };
}

function makeOwnLeaveFieldBurstDef(cardNo: string): CardDefinition {
  return {
    ...makeDef(cardNo, "spirit"),
    keywordTags: ["burst"],
    effects: [
      {
        timing: { kind: "burst", trigger: "自分のスピリットが離れた後" },
        steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      },
    ],
  };
}

function makeOptionalHandSummonTriggerDef(cardNo: string): CardDefinition {
  return {
    ...makeDef(cardNo, "spirit"),
    effects: [
      {
        timing: {
          kind: "game_event",
          event: "summon",
          player: "self",
          cause: ["self_effect"],
        },
        applicability: { zone: "hand" },
        executionMode: "optional",
        steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      },
    ],
  };
}

function makeEffectSummonDrawTriggerDef(cardNo: string): CardDefinition {
  return {
    ...makeDef(cardNo, "spirit"),
    effects: [
      {
        timing: {
          kind: "game_event",
          event: "summon",
          player: "self",
          cause: ["self_effect"],
        },
        applicability: { zone: "field" },
        steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      },
    ],
  };
}

function makeSelfSummonDrawTriggerDef(cardNo: string): CardDefinition {
  return {
    ...makeDef(cardNo, "spirit"),
    effects: [
      {
        timing: { kind: "card_event", event: "summon" },
        applicability: { zone: "field" },
        steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      },
    ],
  };
}

function makeDestroyCountTriggerDef(cardNo: string): CardDefinition {
  return {
    ...makeDef(cardNo, "spirit"),
    effects: [
      {
        timing: { kind: "card_event", event: "destroy" },
        applicability: { zone: "field" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ],
  };
}

function makeRemoveFromGameCountTriggerDef(cardNo: string): CardDefinition {
  return {
    ...makeDef(cardNo, "spirit"),
    effects: [
      {
        timing: { kind: "card_event", event: "remove_from_game" },
        applicability: { zone: "field" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ],
  };
}

function makeAfterDrawOptionalCountTriggerDef(cardNo: string): CardDefinition {
  return {
    ...makeDef(cardNo, "spirit"),
    textLines: ["自分がドローした後、カウント+1する after_draw test"],
    effects: [
      {
        timing: {
          kind: "game_event",
          event: "after_draw",
          player: "self",
        },
        applicability: { zone: "field" },
        executionMode: "optional",
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ],
  };
}

function makeTargetedOptionalCountTriggerDef(
  cardNo: string,
  triggerSourceFilter?: CardFilter
): CardDefinition {
  return {
    ...makeDef(cardNo, "spirit"),
    textLines: [
      "BSDB01-M02: 自分のカードが相手の効果の対象になるときに割り込む targeted responder test",
    ],
    effects: [
      {
        timing: {
          kind: "game_event",
          event: "targeted",
          player: "self",
          ...(triggerSourceFilter !== undefined ? { triggerSourceFilter } : {}),
        },
        executionMode: "optional",
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ],
  };
}

function makeHandTargetedOptionalCountTriggerDef(
  cardNo: string,
  triggerSourceFilter?: CardFilter
): CardDefinition {
  return {
    ...makeDef(cardNo, "spirit"),
    textLines: [
      "BSDB01-M02: 手札の自分のカードが相手の効果の対象になるときに割り込む targeted responder test",
    ],
    effects: [
      {
        timing: {
          kind: "game_event",
          event: "targeted",
          player: "self",
          ...(triggerSourceFilter !== undefined ? { triggerSourceFilter } : {}),
        },
        applicability: { zone: "hand" },
        executionMode: "optional",
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ],
  };
}

function makeTargetedDestroyMagicDef(cardNo: string): CardDefinition {
  return {
    ...makeDef(cardNo, "magic"),
    levelDefs: [],
    symbolColors: [],
    textLines: ["相手のスピリット1体を破壊する。"],
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
          },
        ],
      },
    ],
  };
}

function makeTwoStepTargetedBpMagicDef(cardNo: string): CardDefinition {
  return {
    ...makeDef(cardNo, "magic"),
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "相手のスピリット1体をBP-1000し、その後、相手のスピリット1体をBP-1000する。",
    ],
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            id: "first",
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
              amount: -1000,
              duration: { scope: "turn" },
            },
          },
          {
            id: "second",
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
              amount: -1000,
              duration: { scope: "turn" },
            },
          },
        ],
      },
    ],
  };
}

function makeRepeatTargetedBpMagicDef(cardNo: string): CardDefinition {
  return {
    ...makeDef(cardNo, "magic"),
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "相手のスピリット1体をBP-1000する。この効果を1回追加で発揮する。",
    ],
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            id: "repeat-bp",
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
              amount: -1000,
              duration: { scope: "turn" },
            },
            repeat: { additional: 1 },
          },
        ],
      },
    ],
  };
}

function makeDrawThenTargetedDestroyMagicDef(cardNo: string): CardDefinition {
  return {
    ...makeDef(cardNo, "magic"),
    levelDefs: [],
    symbolColors: [],
    textLines: ["自分は1枚ドローする。その後、相手のスピリット1体を破壊する。"],
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          { id: "draw", action: { kind: "draw", player: "self", count: 1 } },
          {
            id: "target",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
          },
        ],
      },
    ],
  };
}

function makeSummonTriggeredTargetDestroyDef(cardNo: string): CardDefinition {
  return {
    ...makeDef(cardNo, "spirit"),
    textLines: [
      "召喚時に相手のスピリット1体を破壊する P3-76 ActiveStack targeted disclosure test",
    ],
    effects: [
      {
        timing: { kind: "card_event", event: "summon" },
        applicability: { zone: "field" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
          },
        ],
      },
    ],
  };
}

function makeFieldCard(id: string, playerId: string): CardInstance {
  return createCardInstance(makeDef(id), {
    instanceId: id,
    ownerPlayerId: playerId,
    zone: "field",
    normalCoreCount: 1,
  });
}

function makePendingTriggered(
  overrides: Partial<PendingTriggeredEffect> & {
    id: string;
    actingPlayerId: string;
  }
): PendingTriggeredEffect {
  return {
    id: overrides.id,
    actingPlayerId: overrides.actingPlayerId,
    eventKind: overrides.eventKind ?? "summon",
    source: overrides.source ?? "action_resolution",
    chainId: overrides.chainId ?? null,
    attackId: overrides.attackId ?? null,
    relatedPlayerId: overrides.relatedPlayerId ?? null,
    relatedInstanceId: overrides.relatedInstanceId ?? null,
    amount: overrides.amount ?? null,
    resolvedSourceInstanceIds: overrides.resolvedSourceInstanceIds ?? [],
    simultaneousGroupId: overrides.simultaneousGroupId ?? null,
  };
}

// --- Tests ---

describe("matchesTriggerEvent", () => {
  it("targeted は P3-76 の対象開示 family として一致する", () => {
    const event = triggerEventKindToStructuredEvent("targeted");
    expect(event).toEqual({
      family: "targeting",
      validationMode: "require_related_instance_on_field",
    });
    expect(matchesTriggerEvent({ family: "targeting" }, event)).toBe(true);
  });

  it("P3-75: targeted responder は対象にした効果の発揮タイミングで絞り込める", () => {
    const stackEvent: StructuredTriggerEvent = {
      family: "targeting",
      effectActivationTiming: "stack",
      validationMode: "require_related_instance_on_field",
    };
    const flashEvent: StructuredTriggerEvent = {
      family: "targeting",
      effectActivationTiming: "flash",
      validationMode: "require_related_instance_on_field",
    };

    expect(
      matchesTriggerEvent(
        { family: "targeting", effectActivationTiming: "stack" },
        stackEvent
      )
    ).toBe(true);
    expect(
      matchesTriggerEvent(
        { family: "targeting", effectActivationTiming: "stack" },
        flashEvent
      )
    ).toBe(false);
  });

  it("P3-75: game_event.triggerEffectTiming は eventMatcher に合成される", () => {
    const def: CardDefinition = {
      ...makeDef("TEST-P3-75-TRIGGER-TIMING", "spirit"),
      effects: [
        {
          timing: {
            kind: "game_event",
            event: "targeted",
            player: "self",
            triggerEffectTiming: "stack",
          },
          applicability: { zone: "hand" },
          executionMode: "optional",
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
        },
      ],
    };

    const lookup = buildTriggeredEffectLookup([def]);
    expect(lookup(def.cardNo)[0]?.eventMatcher).toEqual({
      family: "targeting",
      effectActivationTiming: "stack",
    });
  });

  it("matches when family matches", () => {
    const matcher: TriggerEventMatcher = { family: "life" };
    const event: StructuredTriggerEvent = {
      family: "life",
      validationMode: "snapshot_only",
    };
    expect(matchesTriggerEvent(matcher, event)).toBe(true);
  });

  it("does not match when family differs", () => {
    const matcher: TriggerEventMatcher = { family: "life" };
    const event: StructuredTriggerEvent = {
      family: "leave_field",
      validationMode: "snapshot_only",
    };
    expect(matchesTriggerEvent(matcher, event)).toBe(false);
  });

  it("matches when actionKind matches", () => {
    const matcher: TriggerEventMatcher = {
      family: "enter_field",
      actionKind: "summon",
    };
    const event: StructuredTriggerEvent = {
      family: "enter_field",
      actionKind: "summon",
      validationMode: "snapshot_only",
    };
    expect(matchesTriggerEvent(matcher, event)).toBe(true);
  });

  it("does not match when actionKind differs", () => {
    const matcher: TriggerEventMatcher = {
      family: "enter_field",
      actionKind: "summon",
    };
    const event: StructuredTriggerEvent = {
      family: "enter_field",
      actionKind: "placement",
      validationMode: "snapshot_only",
    };
    expect(matchesTriggerEvent(matcher, event)).toBe(false);
  });

  it("matches when matcher has no actionKind but event does", () => {
    const matcher: TriggerEventMatcher = { family: "enter_field" };
    const event: StructuredTriggerEvent = {
      family: "enter_field",
      actionKind: "summon",
      validationMode: "snapshot_only",
    };
    expect(matchesTriggerEvent(matcher, event)).toBe(true);
  });

  it("matches when causeKind matches", () => {
    const matcher: TriggerEventMatcher = {
      family: "leave_field",
      causeKind: "destroy",
    };
    const event: StructuredTriggerEvent = {
      family: "leave_field",
      causeKind: "destroy",
      validationMode: "snapshot_only",
    };
    expect(matchesTriggerEvent(matcher, event)).toBe(true);
  });

  it("does not match when causeKind differs", () => {
    const matcher: TriggerEventMatcher = {
      family: "leave_field",
      causeKind: "destroy",
    };
    const event: StructuredTriggerEvent = {
      family: "leave_field",
      causeKind: "vanish",
      validationMode: "snapshot_only",
    };
    expect(matchesTriggerEvent(matcher, event)).toBe(false);
  });

  it("matches broadly when matcher has family-only for leave_field", () => {
    const matcher: TriggerEventMatcher = { family: "leave_field" };
    const event: StructuredTriggerEvent = {
      family: "leave_field",
      causeKind: "bounce",
      validationMode: "snapshot_only",
    };
    expect(matchesTriggerEvent(matcher, event)).toBe(true);
  });

  // --- subPhase matching ---
  it("matches when subPhase matches", () => {
    const matcher: TriggerEventMatcher = {
      family: "step_timing",
      subPhase: "start",
    };
    const event: StructuredTriggerEvent = {
      family: "step_timing",
      subPhase: "start",
      validationMode: "snapshot_only",
    };
    expect(matchesTriggerEvent(matcher, event)).toBe(true);
  });

  it("does not match when subPhase differs", () => {
    const matcher: TriggerEventMatcher = {
      family: "step_timing",
      subPhase: "start",
    };
    const event: StructuredTriggerEvent = {
      family: "step_timing",
      subPhase: "end",
      validationMode: "snapshot_only",
    };
    expect(matchesTriggerEvent(matcher, event)).toBe(false);
  });

  it("matches when matcher has no subPhase (wildcard)", () => {
    const matcher: TriggerEventMatcher = { family: "step_timing" };
    const event: StructuredTriggerEvent = {
      family: "step_timing",
      subPhase: "start",
      validationMode: "snapshot_only",
    };
    expect(matchesTriggerEvent(matcher, event)).toBe(true);
  });

  it("matches when event has no subPhase (backward compat)", () => {
    const matcher: TriggerEventMatcher = {
      family: "step_timing",
      subPhase: "start",
    };
    const event: StructuredTriggerEvent = {
      family: "step_timing",
      validationMode: "snapshot_only",
    };
    expect(matchesTriggerEvent(matcher, event)).toBe(true);
  });
});

describe("triggerEventKindToStructuredEvent", () => {
  it("life_reduced → life family", () => {
    const event = triggerEventKindToStructuredEvent("reduce_life");
    expect(event.family).toBe("life");
  });

  it("card_destroyed → leave_field with destroy cause", () => {
    const event = triggerEventKindToStructuredEvent("destroy");
    expect(event.family).toBe("leave_field");
    expect(event.causeKind).toBe("destroy");
  });

  it("card_vanished → leave_field with vanish cause", () => {
    const event = triggerEventKindToStructuredEvent("vanish");
    expect(event.family).toBe("leave_field");
    expect(event.causeKind).toBe("vanish");
  });

  it("spirit_summoned → enter_field with summon action", () => {
    const event = triggerEventKindToStructuredEvent("summon");
    expect(event.family).toBe("enter_field");
    expect(event.actionKind).toBe("summon");
  });

  it("nexus_placed → enter_field with placement action", () => {
    const event = triggerEventKindToStructuredEvent("place");
    expect(event.family).toBe("enter_field");
    expect(event.actionKind).toBe("placement");
  });

  it("hand_increased → hand_increase family", () => {
    const event = triggerEventKindToStructuredEvent("increase_hand");
    expect(event.family).toBe("hand_increase");
  });
});

describe("burstEventKindToStructuredEvent", () => {
  it("life_reduced → life family", () => {
    const event = burstEventKindToStructuredEvent("reduce_life");
    expect(event.family).toBe("life");
  });

  it("attack_after → action_after with attack action", () => {
    const event = burstEventKindToStructuredEvent("attack_after");
    expect(event.family).toBe("action_after");
    expect(event.actionKind).toBe("attack");
  });

  it("spirit_summoned → enter_field with summon action", () => {
    const event = burstEventKindToStructuredEvent("summon");
    expect(event.family).toBe("enter_field");
    expect(event.actionKind).toBe("summon");
  });

  it("leave_field → leave_field family", () => {
    const event = burstEventKindToStructuredEvent("leave_field");
    expect(event.family).toBe("leave_field");
  });
});

describe("getTriggeredEffectSourceUseBlockReason", () => {
  const def = makeDef("TEST-001", "spirit");

  it("returns null when source is valid spirit on field controlled by acting player", () => {
    const card = makeFieldCard("card-1", "alice");
    expect(
      getTriggeredEffectSourceUseBlockReason("alice", "spirit", card, def)
    ).toBeNull();
  });

  it("returns block reason when not controlled by acting player", () => {
    const card = makeFieldCard("card-1", "bob");
    expect(
      getTriggeredEffectSourceUseBlockReason("alice", "spirit", card, def)
    ).toBe("source_not_controlled_by_acting_player");
  });

  it("returns block reason when not on field", () => {
    const card = createCardInstance(def, {
      instanceId: "card-1",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    expect(
      getTriggeredEffectSourceUseBlockReason("alice", "spirit", card, def)
    ).toBe("source_not_on_field");
  });

  it("returns null for system source kind regardless of category", () => {
    const nexusDef = makeDef("NEXUS-001", "nexus");
    const card = makeFieldCard("card-1", "alice");
    expect(
      getTriggeredEffectSourceUseBlockReason("alice", "system", card, nexusDef)
    ).toBeNull();
  });

  it("returns mismatch when source kind does not match printed category", () => {
    const nexusDef = makeDef("NEXUS-001", "nexus");
    const card = makeFieldCard("card-1", "alice");
    expect(
      getTriggeredEffectSourceUseBlockReason("alice", "spirit", card, nexusDef)
    ).toBe("source_kind_category_mismatch");
  });

  // --- whose parameter ---
  it("whose='self': allows card controlled by acting player", () => {
    const card = makeFieldCard("card-1", "alice");
    expect(
      getTriggeredEffectSourceUseBlockReason(
        "alice",
        "spirit",
        card,
        def,
        "self"
      )
    ).toBeNull();
  });

  it("whose='self': blocks card NOT controlled by acting player", () => {
    const card = makeFieldCard("card-1", "bob");
    expect(
      getTriggeredEffectSourceUseBlockReason(
        "alice",
        "spirit",
        card,
        def,
        "self"
      )
    ).toBe("source_not_controlled_by_acting_player");
  });

  it("whose='opponent': allows card NOT controlled by acting player", () => {
    const card = makeFieldCard("card-1", "bob");
    expect(
      getTriggeredEffectSourceUseBlockReason(
        "alice",
        "spirit",
        card,
        def,
        "opponent"
      )
    ).toBeNull();
  });

  it("whose='opponent': blocks card controlled by acting player", () => {
    const card = makeFieldCard("card-1", "alice");
    expect(
      getTriggeredEffectSourceUseBlockReason(
        "alice",
        "spirit",
        card,
        def,
        "opponent"
      )
    ).toBe("source_not_controlled_by_acting_player");
  });

  it("whose='either': allows card controlled by acting player", () => {
    const card = makeFieldCard("card-1", "alice");
    expect(
      getTriggeredEffectSourceUseBlockReason(
        "alice",
        "spirit",
        card,
        def,
        "either"
      )
    ).toBeNull();
  });

  it("whose='either': allows card NOT controlled by acting player", () => {
    const card = makeFieldCard("card-1", "bob");
    expect(
      getTriggeredEffectSourceUseBlockReason(
        "alice",
        "spirit",
        card,
        def,
        "either"
      )
    ).toBeNull();
  });

  it("whose=undefined defaults to 'self' behavior", () => {
    const bobCard = makeFieldCard("card-1", "bob");
    expect(
      getTriggeredEffectSourceUseBlockReason(
        "alice",
        "spirit",
        bobCard,
        def,
        undefined
      )
    ).toBe("source_not_controlled_by_acting_player");
  });

  // --- sourceZone parameter ---
  it("sourceZone='hand': allows card in hand", () => {
    const card = createCardInstance(def, {
      instanceId: "card-1",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    expect(
      getTriggeredEffectSourceUseBlockReason(
        "alice",
        "spirit",
        card,
        def,
        undefined,
        "hand"
      )
    ).toBeNull();
  });

  it("sourceZone='hand': blocks card on field", () => {
    const card = makeFieldCard("card-1", "alice");
    expect(
      getTriggeredEffectSourceUseBlockReason(
        "alice",
        "spirit",
        card,
        def,
        undefined,
        "hand"
      )
    ).toBe("source_not_on_field");
  });

  it("sourceZone=['hand','set_aside']: allows card in hand", () => {
    const card = createCardInstance(def, {
      instanceId: "card-1",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    expect(
      getTriggeredEffectSourceUseBlockReason(
        "alice",
        "spirit",
        card,
        def,
        undefined,
        ["hand", "set_aside"]
      )
    ).toBeNull();
  });

  it("sourceZone undefined: blocks card in hand (backward compat)", () => {
    const card = createCardInstance(def, {
      instanceId: "card-1",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    expect(
      getTriggeredEffectSourceUseBlockReason("alice", "spirit", card, def)
    ).toBe("source_not_on_field");
  });
});

describe("getSimultaneousGroups", () => {
  it("returns empty map for no pending effects", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [],
    });
    const groups = getSimultaneousGroups(state);
    expect(groups.size).toBe(0);
  });

  it("groups effects by simultaneousGroupId", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [],
    });
    state.pendingTriggeredEffects = [
      makePendingTriggered({
        id: "t1",
        actingPlayerId: "alice",
        simultaneousGroupId: "group-A",
      }),
      makePendingTriggered({
        id: "t2",
        actingPlayerId: "alice",
        simultaneousGroupId: "group-A",
      }),
      makePendingTriggered({
        id: "t3",
        actingPlayerId: "bob",
        simultaneousGroupId: "group-B",
      }),
    ];
    const groups = getSimultaneousGroups(state);
    expect(groups.size).toBe(2);
    expect(groups.get("group-A")?.length).toBe(2);
    expect(groups.get("group-B")?.length).toBe(1);
  });

  it("uses 'ungrouped' key for effects without simultaneousGroupId", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [],
    });
    state.pendingTriggeredEffects = [
      makePendingTriggered({
        id: "t1",
        actingPlayerId: "alice",
        simultaneousGroupId: null,
      }),
      makePendingTriggered({
        id: "t2",
        actingPlayerId: "alice",
        simultaneousGroupId: null,
      }),
    ];
    const groups = getSimultaneousGroups(state);
    expect(groups.size).toBe(1);
    expect(groups.get("ungrouped")?.length).toBe(2);
  });
});

describe("collectTriggerEventsFromStateDelta", () => {
  it("detects life reduction", () => {
    const cards = [makeFieldCard("c1", "alice")];
    const before = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: cards,
      }),
      players: [
        {
          id: "alice",
          deckCount: 30,
          handCount: 4,
          lifeNormalCoreCount: 5,
          reserveNormalCoreCount: 3,
          trashNormalCoreCount: 0,
          voidNormalCoreCount: 188,
          soulCoreLocation: null,
          reserveSoulCoreCount: 0,
          trashSoulCoreCount: 0,
          lifeSoulCoreCount: 0,
        },
        {
          id: "bob",
          deckCount: 30,
          handCount: 4,
          lifeNormalCoreCount: 5,
          reserveNormalCoreCount: 3,
          trashNormalCoreCount: 0,
          voidNormalCoreCount: 188,
          soulCoreLocation: null,
          reserveSoulCoreCount: 0,
          trashSoulCoreCount: 0,
          lifeSoulCoreCount: 0,
        },
      ],
    } as GameState;

    const after = {
      ...before,
      players: [
        { ...before.players[0]!, lifeNormalCoreCount: 3 },
        before.players[1]!,
      ],
    } as GameState;

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: null,
      attackId: null,
    });

    const lifeEvents = events.filter((e) => e.eventKind === "reduce_life");
    expect(lifeEvents.length).toBe(1);
    expect(lifeEvents[0]!.relatedPlayerId).toBe("alice");
    expect(lifeEvents[0]!.amount).toBe(2);
  });

  it("detects card entering field (spirit summoned)", () => {
    const cardBefore = createCardInstance(makeDef("S001"), {
      instanceId: "s1",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const cardAfter = {
      ...cardBefore,
      zone: "field" as const,
      zoneRoleName: "spirit",
    };

    const before = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [cardBefore],
      }),
    };
    const after = {
      ...before,
      cardInstances: [cardAfter],
    };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before as GameState,
      afterState: after as GameState,
      source: "action_resolution",
      chainId: null,
      attackId: null,
    });

    const enterEvents = events.filter((e) => e.eventKind === "summon");
    expect(enterEvents.length).toBe(1);
    expect(enterEvents[0]!.relatedInstanceId).toBe("s1");
    // 場入り前ゾーン (手札) を fromZone に載せる (trigger_from_zone 評価用)。
    expect(enterEvents[0]!.fromZone).toBe("hand");
  });

  it("summon イベントが場入り前ゾーン (deck) を fromZone に載せる", () => {
    const cardBefore = createCardInstance(makeDef("S002"), {
      instanceId: "s2",
      ownerPlayerId: "alice",
      zone: "deck",
    });
    const cardAfter = {
      ...cardBefore,
      zone: "field" as const,
      zoneRoleName: "spirit",
    };
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [cardBefore],
    });
    const after = { ...before, cardInstances: [cardAfter] };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before as GameState,
      afterState: after as GameState,
      source: "action_resolution",
      chainId: null,
      attackId: null,
    });

    const enterEvents = events.filter((e) => e.eventKind === "summon");
    expect(enterEvents.length).toBe(1);
    expect(enterEvents[0]!.fromZone).toBe("deck");
  });

  it("detects card leaving field (destroyed) via pendingLeaveEntities", () => {
    const card = makeFieldCard("d1", "alice");

    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [card],
    });
    const after = {
      ...before,
      cardInstances: [card],
      // 破壊はpendingLeaveEntities経由で検知される
      pendingLeaveEntities: [
        {
          instanceId: "d1",
          kind: "destroy" as const,
          cause: "effect" as const,
          chainId: null,
        },
      ],
    };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before as GameState,
      afterState: after as GameState,
      source: "action_resolution",
      chainId: null,
      attackId: null,
    });

    const leaveEvents = events.filter((e) => e.eventKind === "destroy");
    expect(leaveEvents.length).toBe(1);
    expect(leaveEvents[0]!.relatedInstanceId).toBe("d1");
  });

  it("detects remove_from_game pendingLeave and queues card_event:remove_from_game plus leave_field burst", () => {
    const triggerDef = makeRemoveFromGameCountTriggerDef(
      "TEST-REMOVE-FROM-GAME-TRIGGER"
    );
    const burstDef = makeOwnLeaveFieldBurstDef("TEST-REMOVE-FROM-GAME-BURST");
    const definitions = [triggerDef, burstDef];
    const lookup = makeLookup(definitions);
    const burstCard = createCardInstance(burstDef, {
      instanceId: "alice-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const card = createCardInstance(triggerDef, {
      instanceId: "rfg-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [card, burstCard],
    });
    const after: GameState = {
      ...before,
      setBurstStates: [{ playerId: "alice", cardInstanceId: "alice-burst" }],
      pendingLeaveEntities: [
        {
          instanceId: "rfg-1",
          kind: "remove_from_game",
          cause: "effect_resolution",
          causePlayerId: "bob",
          chainId: "chain-remove-from-game",
          deferZoneMoveUntilChainEnd: false,
        },
      ],
    };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: "chain-remove-from-game",
      attackId: null,
    });
    const removeEvents = events.filter(
      (event) => event.eventKind === "remove_from_game"
    );
    expect(removeEvents).toHaveLength(1);
    expect(removeEvents[0]?.relatedInstanceId).toBe("rfg-1");
    expect(removeEvents[0]?.cause).toBe("opponent_effect");

    const queued = queuePendingReactionsFromTriggerEvents(
      after,
      events,
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(definitions),
        getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      }
    );
    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    expect(queued.pendingTriggeredEffects[0]?.eventKind).toBe(
      "remove_from_game"
    );
    expect(queued.pendingTriggeredEffects[0]?.relatedInstanceId).toBe("rfg-1");
    expect(queued.pendingBurstChecks).toHaveLength(1);
    expect(queued.pendingBurstChecks[0]?.eventKind).toBe("leave_field");
    expect(queued.pendingBurstChecks[0]?.relatedPlayerId).toBe("alice");
  });

  it("同一 chain の destroyed_only 抑止は破壊バッチ全体の sourceId を各 leave event に載せる", () => {
    const first = makeFieldCard("d-batch-1", "alice");
    const second = makeFieldCard("d-batch-2", "alice");
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [first, second],
    });
    const after = {
      ...before,
      pendingLeaveEntities: [
        {
          instanceId: "d-batch-1",
          kind: "destroy" as const,
          cause: "effect_resolution" as const,
          causePlayerId: "bob",
          chainId: "chain-batch-destroy",
          deferZoneMoveUntilChainEnd: false,
          suppressDestroyedEffects: "destroyed_only" as const,
        },
        {
          instanceId: "d-batch-2",
          kind: "destroy" as const,
          cause: "effect_resolution" as const,
          causePlayerId: "bob",
          chainId: "chain-batch-destroy",
          deferZoneMoveUntilChainEnd: false,
          suppressDestroyedEffects: "destroyed_only" as const,
        },
      ],
    };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before as GameState,
      afterState: after as GameState,
      source: "action_resolution",
      chainId: "chain-batch-destroy",
      attackId: null,
    });

    const leaveEvents = events
      .filter((event) => event.eventKind === "destroy")
      .sort((a, b) =>
        (a.relatedInstanceId ?? "").localeCompare(b.relatedInstanceId ?? "")
      );
    expect(leaveEvents.map((event) => event.relatedInstanceId)).toEqual([
      "d-batch-1",
      "d-batch-2",
    ]);
    for (const event of leaveEvents) {
      expect(event.suppressedSourceInstanceIds?.sort()).toEqual([
        "d-batch-1",
        "d-batch-2",
      ]);
    }
  });

  it("destroyed_only 抑止は flush 後の leave_field event にも破壊バッチ全体を載せる", () => {
    const first = makeFieldCard("d-left-1", "bob");
    const second = makeFieldCard("d-left-2", "bob");
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [first, second],
    });
    const beforeWithPending: GameState = {
      ...before,
      pendingLeaveEntities: [
        {
          instanceId: "d-left-1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "alice",
          chainId: "chain-destroy-left-field",
          deferZoneMoveUntilChainEnd: false,
          suppressDestroyedEffects: "destroyed_only",
        },
        {
          instanceId: "d-left-2",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "alice",
          chainId: "chain-destroy-left-field",
          deferZoneMoveUntilChainEnd: false,
          suppressDestroyedEffects: "destroyed_only",
        },
      ],
    };
    const afterFlush: GameState = {
      ...beforeWithPending,
      pendingLeaveEntities: [],
      cardInstances: beforeWithPending.cardInstances.map((card) =>
        card.instanceId === "d-left-1" || card.instanceId === "d-left-2"
          ? { ...card, zone: "trash" as const }
          : card
      ),
    };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: beforeWithPending,
      afterState: afterFlush,
      source: "action_resolution",
      chainId: "chain-destroy-left-field",
      attackId: null,
    });

    const leaveEvents = events
      .filter((event) => event.eventKind === "leave_field")
      .sort((a, b) =>
        (a.relatedInstanceId ?? "").localeCompare(b.relatedInstanceId ?? "")
      );
    expect(leaveEvents.map((event) => event.relatedInstanceId)).toEqual([
      "d-left-1",
      "d-left-2",
    ]);
    for (const event of leaveEvents) {
      expect(event.suppressedSourceInstanceIds?.sort()).toEqual([
        "d-left-1",
        "d-left-2",
      ]);
    }
  });

  it("engine-generic-effect-activation-causal-trigger round2: 同一 chain の destroyed_only 抑止は vanish バッチ全体の sourceId も各 leave event に載せる（kind を destroy に限定しない回帰確認）", () => {
    const first = makeFieldCard("v-batch-1", "alice");
    const second = makeFieldCard("v-batch-2", "alice");
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [first, second],
    });
    const after = {
      ...before,
      pendingLeaveEntities: [
        {
          instanceId: "v-batch-1",
          kind: "vanish" as const,
          cause: "effect_resolution" as const,
          causePlayerId: "bob",
          chainId: "chain-batch-vanish",
          deferZoneMoveUntilChainEnd: false,
          suppressDestroyedEffects: "destroyed_only" as const,
        },
        {
          instanceId: "v-batch-2",
          kind: "vanish" as const,
          cause: "effect_resolution" as const,
          causePlayerId: "bob",
          chainId: "chain-batch-vanish",
          deferZoneMoveUntilChainEnd: false,
          suppressDestroyedEffects: "destroyed_only" as const,
        },
      ],
    };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before as GameState,
      afterState: after as GameState,
      source: "action_resolution",
      chainId: "chain-batch-vanish",
      attackId: null,
    });

    const leaveEvents = events
      .filter((event) => event.eventKind === "vanish")
      .sort((a, b) =>
        (a.relatedInstanceId ?? "").localeCompare(b.relatedInstanceId ?? "")
      );
    expect(leaveEvents.map((event) => event.relatedInstanceId)).toEqual([
      "v-batch-1",
      "v-batch-2",
    ]);
    for (const event of leaveEvents) {
      expect(event.suppressedSourceInstanceIds?.sort()).toEqual([
        "v-batch-1",
        "v-batch-2",
      ]);
    }
  });

  it("destroyed_only 抑止は破壊バッチ内の別 destroyed source の誘発解決も skip する", () => {
    const triggerDef = makeDestroyCountTriggerDef("TEST-DESTROY-TRIGGER");
    const definitions = [triggerDef];
    const lookup = makeLookup(definitions);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(definitions),
    };
    const first = createCardInstance(triggerDef, {
      instanceId: "d-resolve-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const second = createCardInstance(triggerDef, {
      instanceId: "d-resolve-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{}, { countValue: 0 }],
      cardInstances: [first, second],
    });
    const after: GameState = {
      ...before,
      pendingLeaveEntities: [
        {
          instanceId: "d-resolve-1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "alice",
          chainId: "chain-resolve-batch-destroy",
          deferZoneMoveUntilChainEnd: false,
          suppressDestroyedEffects: "destroyed_only",
        },
        {
          instanceId: "d-resolve-2",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "alice",
          chainId: "chain-resolve-batch-destroy",
          deferZoneMoveUntilChainEnd: false,
          suppressDestroyedEffects: "destroyed_only",
        },
      ],
    };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: "chain-resolve-batch-destroy",
      attackId: null,
    });
    const queued = queuePendingReactionsFromTriggerEvents(
      after,
      events,
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions:
          effectLookups.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: effectLookups.getRegisteredBurstActions,
      }
    );
    expect(queued.pendingTriggeredEffects).toHaveLength(0);
    expect(
      queued.players.find((player) => player.id === "bob")!.countValue
    ).toBe(0);
    expect(
      queued.log.filter((entry) =>
        entry.startsWith("trigger:effect-suppressed:")
      )
    ).toHaveLength(2);
    expect(queued.stackWindow).toBeNull();
  });

  it("P3-76: resolve_pending_effect_target は BSDB01-M02 型 targeted 誘発を効果本体前に挟む", () => {
    const responderDef = makeTargetedOptionalCountTriggerDef(
      "TEST-BSDB01-M02-TARGETED",
      { category: ["magic"] }
    );
    const magicDef = makeTargetedDestroyMagicDef("TEST-P3-76-MAGIC");
    const definitions = [responderDef, magicDef];
    const lookup = makeLookup(definitions);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(definitions),
    };
    const target = createCardInstance(responderDef, {
      instanceId: "targeted-goku-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "p3-76-magic-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{}, { countValue: 0 }],
        cardInstances: [target, magic],
      }),
      activePlayerId: "alice",
      step: "attack",
      pendingEffectTargetSelection: {
        pendingId: "effect-target:p3-76",
        actingPlayerId: "alice",
        sourceInstanceId: "p3-76-magic-1",
        sourceDefinitionId: "TEST-P3-76-MAGIC",
        deferredStack: {
          stackId: "stack:p3-76",
          actionKind: "magic",
          chainId: "chain:p3-76",
          actingPlayerId: "alice",
          cardInstanceId: "p3-76-magic-1",
          cardDefinitionId: "TEST-P3-76-MAGIC",
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          chosenTiming: "flash",
          magicEffectIndex: 0,
          reducedCost: 0,
          totalReduction: 0,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
        remainingStacks: [
          {
            stackId: "stack:p3-76-follow-up",
            actionKind: "magic",
            chainId: "chain:p3-76-follow-up",
            actingPlayerId: "alice",
            cardInstanceId: "p3-76-magic-1",
            cardDefinitionId: "TEST-P3-76-MAGIC",
            targetInstanceIds: ["targeted-goku-1"],
            targetEffectFilterTags: [],
            chosenTiming: "flash",
            magicEffectIndex: 0,
            reducedCost: 0,
            totalReduction: 0,
            previousResponseSourcePlayerId: null,
            previousPendingStackAction: null,
          },
        ],
        requiredTargetCount: 1,
        maxTargetCount: 1,
        candidateInstanceIds: ["targeted-goku-1"],
        targetEffectFilterTags: [],
      },
    };

    const targetAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(targetAction).toBeDefined();

    const afterDisclosure = applyLegalAction({
      state,
      action: targetAction!,
      targetInstanceIds: ["targeted-goku-1"],
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;

    expect(afterDisclosure.pendingEffectTargetSelection).toBeNull();
    expect(afterDisclosure.pendingTargetedDisclosureContinuation).toMatchObject(
      {
        sourceInstanceId: "p3-76-magic-1",
        sourceDefinitionId: "TEST-P3-76-MAGIC",
        targetInstanceIds: ["targeted-goku-1"],
        targetStepId: "__step_0",
      }
    );
    expect(
      afterDisclosure.pendingTargetedDisclosureContinuation?.remainingStacks.map(
        (stack) => stack.stackId
      )
    ).toEqual(["stack:p3-76-follow-up"]);
    const maskedForActingPlayer = maskPendingPromptsForViewer(
      afterDisclosure,
      "alice"
    );
    expect(
      maskedForActingPlayer.pendingTargetedDisclosureContinuation
        ?.effectResolutionBeforeState
    ).toBeUndefined();
    expect(afterDisclosure.pendingTriggeredEffects).toHaveLength(1);
    expect(afterDisclosure.pendingTriggeredEffects[0]).toMatchObject({
      eventKind: "targeted",
      relatedPlayerId: "bob",
      relatedInstanceId: "targeted-goku-1",
      effectSourceInstanceId: "p3-76-magic-1",
      effectSourceDefinitionId: "TEST-P3-76-MAGIC",
      effectActionKind: "magic",
    });
    expect(afterDisclosure.pendingTriggeredEffects[0]?.event).toMatchObject({
      family: "targeting",
      effectSourceInstanceId: "p3-76-magic-1",
      effectSourceDefinitionId: "TEST-P3-76-MAGIC",
      effectActionKind: "magic",
    });
    expect(afterDisclosure.pendingLeaveEntities).toHaveLength(0);

    const skipAction = getLegalActions({
      state: afterDisclosure,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "targeted-goku-1"
    );
    expect(skipAction).toBeDefined();

    const afterSkip = applyLegalAction({
      state: afterDisclosure,
      action: skipAction!,
      skipOptionalEffect: true,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;

    expect(afterSkip.pendingTargetedDisclosureContinuation).toBeNull();
    expect(afterSkip.pendingTriggeredEffects).toHaveLength(0);
    expect(
      afterSkip.pendingLeaveEntities.some(
        (entry) => entry.instanceId === "targeted-goku-1"
      ) ||
        afterSkip.cardInstances.find(
          (card) => card.instanceId === "targeted-goku-1"
        )?.zone === "trash"
    ).toBe(true);
    expect(
      afterSkip.log.some((entry) =>
        entry.startsWith("effect:target-disclosure:queued:chain:p3-76")
      )
    ).toBe(true);

    const cleanupEffectIds = [
      "burst-window-immune-card:p3-76-cleanup",
      "burst-window-immune-player:p3-76-cleanup",
    ];
    const cleanupEffects: ContinuousEffect[] = cleanupEffectIds.map(
      (effectId, index) => ({
        effectId,
        sourceInstanceId: "p3-76-magic-1",
        sourceDefinitionId: "TEST-P3-76-MAGIC",
        actingPlayerId: "alice",
        duration: { scope: "permanent" },
        createdAtTurn: afterDisclosure.turnNumber,
        createdAtAttackId: afterDisclosure.activeAttack?.attackId ?? null,
        modifierTag: index === 0 ? "defense_immune" : "player_effect_immunity",
        targetInstanceId: index === 0 ? "p3-76-magic-1" : "alice",
      })
    );
    const afterDisclosureWithCleanup: GameState = {
      ...afterDisclosure,
      activeContinuousEffects: [
        ...afterDisclosure.activeContinuousEffects,
        ...cleanupEffects,
      ],
      pendingTargetedDisclosureContinuation: {
        ...afterDisclosure.pendingTargetedDisclosureContinuation!,
        resolutionCleanups: [
          {
            kind: "burst_activation_immunity",
            checkId: "p3-76-cleanup",
            effectIds: cleanupEffectIds,
          },
        ],
      },
    };
    const skipWithCleanupAction = getLegalActions({
      state: afterDisclosureWithCleanup,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "targeted-goku-1"
    );
    expect(skipWithCleanupAction).toBeDefined();
    const afterCleanupResume = applyLegalAction({
      state: afterDisclosureWithCleanup,
      action: skipWithCleanupAction!,
      skipOptionalEffect: true,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    expect(
      afterCleanupResume.activeContinuousEffects.some((ce) =>
        cleanupEffectIds.includes(ce.effectId)
      )
    ).toBe(false);
    expect(
      afterCleanupResume.log.some(
        (entry) => entry === "burst:activation-immunity:cleared:p3-76-cleanup"
      )
    ).toBe(true);

    const resolveTargetedAction = getLegalActions({
      state: afterDisclosure,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "targeted-goku-1"
    );
    expect(resolveTargetedAction).toBeDefined();

    const afterTargetedDeclared = applyLegalAction({
      state: afterDisclosure,
      action: resolveTargetedAction!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    expect(
      afterTargetedDeclared.stackWindow?.pendingStackAction?.actionKind
    ).toBe("triggered_effect");

    const passTriggeredAction = getLegalActions({
      state: afterTargetedDeclared,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(passTriggeredAction).toBeDefined();

    const afterTargetedResolved = applyLegalAction({
      state: afterTargetedDeclared,
      action: passTriggeredAction!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    expect(
      afterTargetedResolved.players.find((player) => player.id === "bob")!
        .countValue
    ).toBe(1);
    expect(afterTargetedResolved.pendingStackCascade).toBeNull();
    expect(afterTargetedResolved.pendingTriggeredEffects).toHaveLength(0);
    expect(
      afterTargetedResolved.pendingLeaveEntities.some(
        (entry) => entry.instanceId === "targeted-goku-1"
      ) ||
        afterTargetedResolved.cardInstances.find(
          (card) => card.instanceId === "targeted-goku-1"
        )?.zone === "trash"
    ).toBe(true);
  });

  it("opens a selected delayed burst effect declaration after an empty effect target choice", () => {
    const optionalTargetMagic: CardDefinition = {
      ...makeDef("TEST-EMPTY-TARGET-RESUME", "magic"),
      levelDefs: [],
      symbolColors: [],
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: { min: 0, max: 1 },
                },
              },
            },
          ],
        },
      ],
    };
    const burstDef = makeOpponentSummonBurstDef("TEST-EMPTY-TARGET-BURST");
    const definitions = [optionalTargetMagic, burstDef];
    const lookup = makeLookup(definitions);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(definitions),
    };
    const magic = createCardInstance(optionalTargetMagic, {
      instanceId: "empty-target-magic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const burst = createCardInstance(burstDef, {
      instanceId: "delayed-burst",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "burst",
    });
    const burstCheck = {
      checkId: "burst:empty-target-resume",
      actingPlayerId: "bob",
      eventKind: "opponent_summon" as const,
      source: "action_resolution" as const,
      chainId: "chain:empty-target-resume:after_triggers:0",
      attackId: null,
      relatedPlayerId: "alice",
      amount: 1,
      step: "attack" as const,
      window: "battle_resolution" as const,
      resolvedBurstCardInstanceIds: [],
      activationSelected: true,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [magic, burst],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      revealedBurstStates: [
        {
          playerId: "bob",
          cardInstanceId: burst.instanceId,
          checkId: burstCheck.checkId,
          activationPending: false,
        },
      ],
      pendingBurstChecks: [burstCheck],
      pendingStackCascade: {
        remainingStacks: [
          {
            stackId: "stack:delayed-burst",
            actionKind: "burst_activation",
            chainId: burstCheck.chainId,
            actingPlayerId: "bob",
            cardInstanceId: burst.instanceId,
            cardDefinitionId: burstDef.cardNo,
            targetInstanceIds: [],
            targetEffectFilterTags: [],
            burstCheckId: burstCheck.checkId,
            burstPendingSnapshot: burstCheck,
            burstSourceKind: "spirit",
            burstRegistrationIndex: 0,
            burstActivationSourceZone: "burst",
            burstEffectDeclarationPending: true,
            burstEffectDeclarationPreviousWindow: "battle_resolution",
            previousResponseSourcePlayerId: null,
            previousPendingStackAction: null,
          },
        ],
        waitForTriggeredEffects: true,
      },
      pendingAfterTriggersContinuations: [
        {
          chainId: "test:trigger-system:1879",
          continuationId: "after-triggers:empty-target-resume",
          waitChainId: "chain:empty-target-resume",
          sourceDefinitionId: optionalTargetMagic.cardNo,
          effectIndex: 0,
          resumeEffectOverride: { timing: { kind: "continuous" }, steps: [] },
          sourceInstanceId: magic.instanceId,
          actingPlayerId: "alice",
          resumeStepIndex: 0,
          stepContext: { results: {} },
        },
      ],
      pendingEffectTargetSelection: {
        pendingId: "effect-target:empty-target-resume",
        actingPlayerId: "alice",
        sourceInstanceId: magic.instanceId,
        sourceDefinitionId: optionalTargetMagic.cardNo,
        deferredStack: {
          stackId: "stack:empty-target-magic",
          actionKind: "magic",
          chainId: "magic:empty-target-resume",
          actingPlayerId: "alice",
          cardInstanceId: magic.instanceId,
          cardDefinitionId: optionalTargetMagic.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          chosenTiming: "flash",
          magicEffectIndex: 0,
          reducedCost: 0,
          totalReduction: 0,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
        remainingStacks: [],
        requiredTargetCount: 0,
        maxTargetCount: 1,
        candidateInstanceIds: [],
        targetEffectFilterTags: [],
      },
    };

    const targetAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(targetAction).toBeDefined();

    // A second target prompt from the same preceding effect must drain before
    // the selected burst starts its effect-declaration window. Otherwise the
    // burst becomes established between two sequential target choices.
    const whileSecondTargetIsPending = resumeStackCascadeIfReady(state, {
      getCardDefinitionById: lookup,
      ...effectLookups,
    });
    expect(whileSecondTargetIsPending.stackWindow).toBeNull();
    expect(whileSecondTargetIsPending.pendingStackCascade).not.toBeNull();
    expect(whileSecondTargetIsPending.revealedBurstStates).toContainEqual(
      expect.objectContaining({
        cardInstanceId: burst.instanceId,
        activationPending: false,
      })
    );

    const afterTargetChoice = applyLegalAction({
      state,
      action: targetAction!,
      targetInstanceIds: [],
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;

    expect(afterTargetChoice.pendingEffectTargetSelection).toBeNull();
    expect(afterTargetChoice.pendingStackCascade).toBeNull();
    expect(afterTargetChoice.pendingAfterTriggersContinuations).toHaveLength(0);
    expect(afterTargetChoice.pendingBurstChecks).toContainEqual(
      expect.objectContaining({
        checkId: burstCheck.checkId,
        activationSelected: true,
      })
    );
    expect(afterTargetChoice.window).toBe("stack");
    expect(afterTargetChoice.stackWindow?.burstWindowKind).toBe(
      "effect_declaration"
    );
    expect(afterTargetChoice.stackWindow?.pendingStackAction).toMatchObject({
      stackId: "stack:delayed-burst:effect-decl",
      actionKind: "burst_activation",
    });
  });

  it("P3-76: 同じ効果内でも別 step の対象指定なら targeted 誘発を再度挟む", () => {
    const responderDef = makeTargetedOptionalCountTriggerDef(
      "TEST-BSDB01-M02-TARGETED-TWICE",
      { category: ["magic"] }
    );
    const magicDef = makeTwoStepTargetedBpMagicDef(
      "TEST-P3-76-MAGIC-TWO-STEPS"
    );
    const definitions = [responderDef, magicDef];
    const lookup = makeLookup(definitions);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(definitions),
    };
    const target = createCardInstance(responderDef, {
      instanceId: "targeted-goku-twice",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "p3-76-magic-two-steps",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{}, { countValue: 0 }],
        cardInstances: [target, magic],
      }),
      activePlayerId: "alice",
      step: "attack",
      pendingEffectTargetSelection: {
        pendingId: "effect-target:p3-76-two-steps",
        actingPlayerId: "alice",
        sourceInstanceId: "p3-76-magic-two-steps",
        sourceDefinitionId: "TEST-P3-76-MAGIC-TWO-STEPS",
        deferredStack: {
          stackId: "stack:p3-76-two-steps",
          actionKind: "magic",
          chainId: "chain:p3-76-two-steps",
          actingPlayerId: "alice",
          cardInstanceId: "p3-76-magic-two-steps",
          cardDefinitionId: "TEST-P3-76-MAGIC-TWO-STEPS",
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          chosenTiming: "flash",
          magicEffectIndex: 0,
          reducedCost: 0,
          totalReduction: 0,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
        remainingStacks: [],
        requiredTargetCount: 1,
        maxTargetCount: 1,
        candidateInstanceIds: ["targeted-goku-twice"],
        targetEffectFilterTags: [],
      },
    };

    const targetAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(targetAction).toBeDefined();

    const firstDisclosure = applyLegalAction({
      state,
      action: targetAction!,
      targetInstanceIds: ["targeted-goku-twice"],
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    expect(firstDisclosure.pendingTriggeredEffects).toHaveLength(1);
    expect(firstDisclosure.pendingTargetedDisclosureContinuation).toMatchObject(
      {
        targetStepId: "first",
        targetInstanceIds: ["targeted-goku-twice"],
      }
    );

    const firstSkip = getLegalActions({
      state: firstDisclosure,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "targeted-goku-twice"
    );
    expect(firstSkip).toBeDefined();

    const secondDisclosure = applyLegalAction({
      state: firstDisclosure,
      action: firstSkip!,
      skipOptionalEffect: true,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    expect(secondDisclosure.pendingTriggeredEffects).toHaveLength(1);
    expect(
      secondDisclosure.pendingTargetedDisclosureContinuation
    ).toMatchObject({
      targetStepId: "second",
      targetInstanceIds: ["targeted-goku-twice"],
    });
    expect(
      secondDisclosure.log.filter((entry) =>
        entry.startsWith("effect:target-disclosure:queued:")
      )
    ).toHaveLength(2);
  });

  it("P3-76: targeted 応答中の targeted disclosure は外側 continuation を保持する", () => {
    const responderDef = makeTargetedOptionalCountTriggerDef(
      "TEST-BSDB01-M02-TARGETED-NESTED",
      { category: ["magic"] }
    );
    const nestedMagicDef = makeTargetedDestroyMagicDef(
      "TEST-P3-76-NESTED-MAGIC"
    );
    const parentMagicDef = makeTargetedDestroyMagicDef(
      "TEST-P3-76-PARENT-MAGIC"
    );
    const definitions = [responderDef, nestedMagicDef, parentMagicDef];
    const lookup = makeLookup(definitions);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(definitions),
    };
    const target = createCardInstance(responderDef, {
      instanceId: "alice-targeted-nested",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const nestedSource = createCardInstance(nestedMagicDef, {
      instanceId: "nested-magic-source",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const parentSource = createCardInstance(parentMagicDef, {
      instanceId: "parent-magic-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const parentContinuation: NonNullable<
      GameState["pendingTargetedDisclosureContinuation"]
    > = {
      chainId: "test:trigger-system:2147",
      pendingId: "targeted-disclosure:parent",
      sourceDefinitionId: "TEST-P3-76-PARENT-MAGIC",
      effectIndex: 0,
      sourceInstanceId: "parent-magic-source",
      effectActionKind: "magic",
      actingPlayerId: "alice",
      resumeStepIndex: 0,
      stepContext: { results: {} },
      targetInstanceIds: ["bob-targeted-parent"],
      targetStepId: "__step_0",
      remainingStacks: [],
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [target, nestedSource, parentSource],
      }),
      activePlayerId: "bob",
      step: "attack",
      pendingTargetedDisclosureContinuation: parentContinuation,
    };

    const nestedDisclosure = executeEffect({
      state,
      effect: nestedMagicDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "nested-magic-source",
      actingPlayerId: "bob",
      chainId: "chain:p3-76-nested",
      targetInstanceIds: ["alice-targeted-nested"],
      targetStepId: "__step_0",
      effectActionKind: "magic",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        effectLookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: effectLookups.getRegisteredBurstActions,
    });
    expect(nestedDisclosure.pendingTriggeredEffects).toHaveLength(1);
    expect(
      nestedDisclosure.pendingTargetedDisclosureContinuation
        ?.previousTargetedDisclosureContinuation?.pendingId
    ).toBe(parentContinuation.pendingId);

    const nestedSkip = getLegalActions({
      state: nestedDisclosure,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "alice-targeted-nested"
    );
    expect(nestedSkip).toBeDefined();

    const afterNestedSkip = applyLegalAction({
      state: nestedDisclosure,
      action: nestedSkip!,
      skipOptionalEffect: true,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    expect(afterNestedSkip.pendingTriggeredEffects).toHaveLength(0);
    expect(
      afterNestedSkip.pendingTargetedDisclosureContinuation?.pendingId
    ).toBe(parentContinuation.pendingId);
  });

  it("P3-76: repeat 付き対象 step は targeted disclosure 後も full target list で再開する", () => {
    const responderDef = makeTargetedOptionalCountTriggerDef(
      "TEST-BSDB01-M02-TARGETED-REPEAT",
      { category: ["magic"] }
    );
    const magicDef = makeRepeatTargetedBpMagicDef("TEST-P3-76-MAGIC-REPEAT");
    const targetBDef = makeTargetedOptionalCountTriggerDef(
      "TEST-BSDB01-M02-TARGETED-REPEAT-B",
      { category: ["magic"] }
    );
    const definitions = [responderDef, magicDef, targetBDef];
    const lookup = makeLookup(definitions);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(definitions),
    };
    const targetA = createCardInstance(responderDef, {
      instanceId: "targeted-repeat-a",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const targetB = createCardInstance(targetBDef, {
      instanceId: "targeted-repeat-b",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "p3-76-magic-repeat",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [targetA, targetB, magic],
      }),
      activePlayerId: "alice",
      step: "attack",
    };

    const firstDisclosure = executeEffect({
      state,
      effect: magicDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "p3-76-magic-repeat",
      actingPlayerId: "alice",
      chainId: "chain:p3-76-repeat",
      targetInstanceIds: ["targeted-repeat-a", "targeted-repeat-b"],
      targetStepId: "repeat-bp",
      effectActionKind: "magic",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        effectLookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: effectLookups.getRegisteredBurstActions,
    });
    expect(firstDisclosure.pendingTriggeredEffects).toHaveLength(2);
    expect(
      firstDisclosure.pendingTriggeredEffects.map(
        (pending) => pending.relatedInstanceId
      )
    ).toEqual(["targeted-repeat-a", "targeted-repeat-b"]);
    expect(firstDisclosure.pendingTargetedDisclosureContinuation).toMatchObject(
      {
        chainId: "chain:p3-76-repeat",
        targetStepId: "repeat-bp",
        targetInstanceIds: ["targeted-repeat-a", "targeted-repeat-b"],
        skipTargetedDisclosureTargetStart: 0,
        skipTargetedDisclosureTargetCount: 2,
      }
    );

    expect(
      firstDisclosure.pendingTriggeredEffects.map((pending) => pending.chainId)
    ).toEqual([
      "chain:p3-76-repeat:step:0:activation:0:target:0",
      "chain:p3-76-repeat:step:0:activation:0:target:1",
    ]);
  });

  it("P3-76: targeted disclosure 前の同一効果 delta は resume 後の finalize で収集される", () => {
    const drawListenerDef = makeAfterDrawOptionalCountTriggerDef(
      "TEST-AFTER-DRAW-LISTENER-P3-76"
    );
    const responderDef = makeTargetedOptionalCountTriggerDef(
      "TEST-BSDB01-M02-TARGETED-AFTER-DRAW",
      { category: ["magic"] }
    );
    const magicDef = makeDrawThenTargetedDestroyMagicDef(
      "TEST-P3-76-MAGIC-DRAW-THEN-TARGET"
    );
    const definitions = [drawListenerDef, responderDef, magicDef];
    const lookup = makeLookup(definitions);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(definitions),
    };
    const drawListener = createCardInstance(drawListenerDef, {
      instanceId: "after-draw-listener-p3-76",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(responderDef, {
      instanceId: "targeted-after-draw",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "p3-76-magic-draw-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [drawListener, target, magic],
      }),
      activePlayerId: "alice",
      step: "attack",
    };

    const disclosure = executeEffect({
      state,
      effect: magicDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "p3-76-magic-draw-target",
      actingPlayerId: "alice",
      chainId: "chain:p3-76-draw-target",
      targetInstanceIds: ["targeted-after-draw"],
      targetStepId: "target",
      effectActionKind: "magic",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        effectLookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: effectLookups.getRegisteredBurstActions,
    });
    expect(disclosure.players.find((p) => p.id === "alice")?.handCount).toBe(5);
    expect(disclosure.pendingTriggeredEffects).toHaveLength(1);
    expect(disclosure.pendingTriggeredEffects[0]?.eventKind).toBe("targeted");

    const skip = getLegalActions({
      state: disclosure,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "targeted-after-draw"
    );
    expect(skip).toBeDefined();

    const afterSkip = applyLegalAction({
      state: disclosure,
      action: skip!,
      skipOptionalEffect: true,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    expect(afterSkip.pendingTargetedDisclosureContinuation).toBeNull();
    expect(
      afterSkip.pendingTriggeredEffects.some(
        (pending) =>
          pending.eventKind === "after_draw" &&
          pending.relatedPlayerId === "alice"
      )
    ).toBe(true);
  });

  it("P3-76: allowDuplicateTargets の同一タイミング重複対象は BSDB01-M02 型 targeted 誘発を1回だけ積む", () => {
    const responderDef = makeTargetedOptionalCountTriggerDef(
      "TEST-BSDB01-M02-TARGETED-DUPLICATE",
      { category: ["magic"] }
    );
    const magicDef = makeTargetedDestroyMagicDef("TEST-P3-76-MAGIC-DUPLICATE");
    const definitions = [responderDef, magicDef];
    const lookup = makeLookup(definitions);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(definitions),
    };
    const target = createCardInstance(responderDef, {
      instanceId: "targeted-goku-duplicate",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "p3-76-magic-duplicate",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [target, magic],
      }),
      activePlayerId: "alice",
      step: "attack",
      pendingEffectTargetSelection: {
        pendingId: "effect-target:p3-76-duplicate",
        actingPlayerId: "alice",
        sourceInstanceId: "p3-76-magic-duplicate",
        sourceDefinitionId: "TEST-P3-76-MAGIC-DUPLICATE",
        deferredStack: {
          stackId: "stack:p3-76-duplicate",
          actionKind: "magic",
          chainId: "chain:p3-76-duplicate",
          actingPlayerId: "alice",
          cardInstanceId: "p3-76-magic-duplicate",
          cardDefinitionId: "TEST-P3-76-MAGIC-DUPLICATE",
          targetInstanceIds: [],
          allowDuplicateTargets: true,
          targetEffectFilterTags: [],
          chosenTiming: "flash",
          magicEffectIndex: 0,
          reducedCost: 0,
          totalReduction: 0,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
        remainingStacks: [],
        requiredTargetCount: 2,
        maxTargetCount: 2,
        allowDuplicateTargets: true,
        candidateInstanceIds: ["targeted-goku-duplicate"],
        targetEffectFilterTags: [],
      },
    };

    const targetAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(targetAction).toBeDefined();

    const afterDisclosure = applyLegalAction({
      state,
      action: targetAction!,
      targetInstanceIds: ["targeted-goku-duplicate", "targeted-goku-duplicate"],
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;

    expect(afterDisclosure.pendingTriggeredEffects).toHaveLength(1);
    expect(
      afterDisclosure.pendingTriggeredEffects.map(
        (pending) => pending.relatedInstanceId
      )
    ).toEqual(["targeted-goku-duplicate"]);
    expect(
      afterDisclosure.log.some((entry) =>
        entry.endsWith(":targeted-goku-duplicate,targeted-goku-duplicate")
      )
    ).toBe(true);
  });

  it("P3-76: ActiveStack の確定済み対象も BSDB01-M02 型 targeted 誘発を効果本体前に挟む", () => {
    const responderDef = makeTargetedOptionalCountTriggerDef(
      "TEST-BSDB01-M02-TARGETED-STACK",
      { category: ["spirit"] }
    );
    const sourceDef = makeSummonTriggeredTargetDestroyDef(
      "TEST-P3-76-TRIGGERED-DESTROY"
    );
    const definitions = [responderDef, sourceDef];
    const lookup = makeLookup(definitions);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(definitions),
    };
    const source = createCardInstance(sourceDef, {
      instanceId: "p3-76-trigger-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(responderDef, {
      instanceId: "targeted-goku-stack",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{}, { countValue: 0 }],
        cardInstances: [source, target],
      }),
      activePlayerId: "alice",
      step: "main",
      pendingTriggeredEffects: [
        {
          pendingId: "p3-76-triggered-pending",
          eventKind: "summon",
          actingPlayerId: "alice",
          source: "action_resolution",
          chainId: "chain:p3-76-triggered",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "p3-76-trigger-source",
          amount: null,
          step: "main",
          window: "default",
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const declaration = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "p3-76-trigger-source"
    );
    expect(declaration).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: declaration!,
      targetInstanceIds: ["targeted-goku-stack"],
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    expect(declared.stackWindow?.pendingStackAction?.actionKind).toBe(
      "triggered_effect"
    );
    expect(declared.pendingTriggeredEffects).toHaveLength(0);

    const passAction = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(passAction).toBeDefined();

    const afterDisclosure = applyLegalAction({
      state: declared,
      action: passAction!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;

    expect(afterDisclosure.stackWindow).toBeNull();
    expect(afterDisclosure.pendingTargetedDisclosureContinuation).toMatchObject(
      {
        sourceInstanceId: "p3-76-trigger-source",
        sourceDefinitionId: "TEST-P3-76-TRIGGERED-DESTROY",
        targetInstanceIds: ["targeted-goku-stack"],
        targetStepId: "__step_0",
      }
    );
    expect(afterDisclosure.pendingTriggeredEffects).toHaveLength(1);
    expect(afterDisclosure.pendingTriggeredEffects[0]).toMatchObject({
      eventKind: "targeted",
      relatedPlayerId: "bob",
      relatedInstanceId: "targeted-goku-stack",
      effectSourceInstanceId: "p3-76-trigger-source",
      effectSourceDefinitionId: "TEST-P3-76-TRIGGERED-DESTROY",
      effectActionKind: "triggered_effect",
    });
    expect(afterDisclosure.pendingLeaveEntities).toHaveLength(0);

    const skipAction = getLegalActions({
      state: afterDisclosure,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "targeted-goku-stack"
    );
    expect(skipAction).toBeDefined();

    const afterSkip = applyLegalAction({
      state: afterDisclosure,
      action: skipAction!,
      skipOptionalEffect: true,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;

    expect(afterSkip.pendingTargetedDisclosureContinuation).toBeNull();
    expect(afterSkip.pendingTriggeredEffects).toHaveLength(0);
    expect(
      afterSkip.pendingLeaveEntities.some(
        (entry) => entry.instanceId === "targeted-goku-stack"
      ) ||
        afterSkip.cardInstances.find(
          (card) => card.instanceId === "targeted-goku-stack"
        )?.zone === "trash"
    ).toBe(true);
    expect(
      afterSkip.log.some((entry) =>
        entry.startsWith("effect:target-disclosure:queued:trigger:")
      )
    ).toBe(true);
  });

  it("P3-76: BSDB01-M02 型 targeted 誘発は発揮元カードの triggerSourceFilter で絞る", () => {
    const magicResponderDef = makeTargetedOptionalCountTriggerDef(
      "TEST-BSDB01-M02-SOURCE-FILTER-MAGIC",
      { category: ["magic"] }
    );
    const spiritResponderDef = makeTargetedOptionalCountTriggerDef(
      "TEST-BSDB01-M02-SOURCE-FILTER-SPIRIT",
      { category: ["spirit"] }
    );
    const magicDef = makeTargetedDestroyMagicDef("TEST-P3-76-SOURCE-MAGIC");
    const definitions = [magicResponderDef, spiritResponderDef, magicDef];
    const lookup = makeLookup(definitions);
    const magicResponder = createCardInstance(magicResponderDef, {
      instanceId: "targeted-source-filter-magic",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const spiritResponder = createCardInstance(spiritResponderDef, {
      instanceId: "targeted-source-filter-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(makeDef("TEST-P3-76-SOURCE-TARGET"), {
      instanceId: "targeted-source-filter-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "p3-76-source-filter-magic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [magicResponder, spiritResponder, target, magic],
    });

    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: {
        pendingId: "p3-76-source-filter-pending",
        actingPlayerId: "bob",
        eventKind: "targeted",
        source: "action_resolution",
        chainId: "chain:p3-76-source-filter",
        attackId: null,
        relatedPlayerId: "bob",
        relatedInstanceId: "targeted-source-filter-target",
        amount: 1,
        step: "attack",
        window: "default",
        resolvedSourceInstanceIds: [],
        effectSourceInstanceId: "p3-76-source-filter-magic",
        effectSourceDefinitionId: "TEST-P3-76-SOURCE-MAGIC",
        effectActionKind: "magic",
      },
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
    });

    expect(choices.map((choice) => choice.sourceDefinition.cardNo)).toEqual([
      "TEST-BSDB01-M02-SOURCE-FILTER-MAGIC",
    ]);
  });

  it("P3-76: triggerFilter は対象カードの実効系統を見る", () => {
    const responderDef: CardDefinition = {
      ...makeDef("TEST-BSSL01-R02-EFFECTIVE-TRIBE", "spirit"),
      effects: [
        {
          timing: {
            kind: "game_event",
            event: "targeted",
            player: "self",
            triggerFilter: { category: ["spirit"], tribes: ["影"] },
          },
          executionMode: "optional",
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
        },
      ],
    };
    const targetDef: CardDefinition = {
      ...makeDef("TEST-P3-76-EFFECTIVE-TRIBE-TARGET", "spirit"),
      tribe: "光導",
    };
    const magicDef = makeTargetedDestroyMagicDef(
      "TEST-P3-76-EFFECTIVE-TRIBE-MAGIC"
    );
    const definitions = [responderDef, targetDef, magicDef];
    const lookup = makeLookup(definitions);
    const responder = createCardInstance(responderDef, {
      instanceId: "effective-tribe-responder",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "effective-tribe-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "effective-tribe-magic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [responder, target, magic],
      }),
      activeContinuousEffects: [
        {
          effectId: "ce-effective-tribe-shadow",
          sourceInstanceId: "effective-tribe-responder",
          sourceDefinitionId: responderDef.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "permanent" as const },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "override_properties" as const,
          targetInstanceId: "effective-tribe-target",
          metadata: {
            properties: { addTribes: ["影"] },
          },
        } satisfies ContinuousEffect,
      ],
    };

    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: {
        pendingId: "p3-76-effective-tribe-pending",
        actingPlayerId: "bob",
        eventKind: "targeted",
        source: "action_resolution",
        chainId: "chain:p3-76-effective-tribe",
        attackId: null,
        relatedPlayerId: "bob",
        relatedInstanceId: "effective-tribe-target",
        amount: 1,
        step: "attack",
        window: "default",
        resolvedSourceInstanceIds: [],
        effectSourceInstanceId: "effective-tribe-magic",
        effectSourceDefinitionId: magicDef.cardNo,
        effectActionKind: "magic",
      },
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
    });

    expect(choices.map((choice) => choice.sourceDefinition.cardNo)).toEqual([
      "TEST-BSSL01-R02-EFFECTIVE-TRIBE",
    ]);
  });

  it("P3-76: triggerSourceFilter は発揮元カードの実効系統を見る", () => {
    const responderDef = makeTargetedOptionalCountTriggerDef(
      "TEST-P3-76-SOURCE-EFFECTIVE-TRIBE-RESPONDER",
      { tribes: ["影"] }
    );
    const targetDef = makeDef("TEST-P3-76-SOURCE-EFFECTIVE-TRIBE-TARGET");
    const magicDef = {
      ...makeTargetedDestroyMagicDef("TEST-P3-76-SOURCE-EFFECTIVE-TRIBE-MAGIC"),
      tribe: "導魔",
    };
    const definitions = [responderDef, targetDef, magicDef];
    const lookup = makeLookup(definitions);
    const responder = createCardInstance(responderDef, {
      instanceId: "source-effective-tribe-responder",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "source-effective-tribe-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "source-effective-tribe-magic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [responder, target, magic],
      }),
      activeContinuousEffects: [
        {
          effectId: "ce-source-effective-tribe-shadow",
          sourceInstanceId: "source-effective-tribe-responder",
          sourceDefinitionId: responderDef.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "permanent" as const },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "override_properties" as const,
          targetInstanceId: "source-effective-tribe-magic",
          metadata: {
            properties: { addTribes: ["影"] },
          },
        } satisfies ContinuousEffect,
      ],
    };

    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: {
        pendingId: "p3-76-source-effective-tribe-pending",
        actingPlayerId: "bob",
        eventKind: "targeted",
        source: "action_resolution",
        chainId: "chain:p3-76-source-effective-tribe",
        attackId: null,
        relatedPlayerId: "bob",
        relatedInstanceId: "source-effective-tribe-target",
        amount: 1,
        step: "attack",
        window: "default",
        resolvedSourceInstanceIds: [],
        effectSourceInstanceId: "source-effective-tribe-magic",
        effectSourceDefinitionId: magicDef.cardNo,
        effectActionKind: "magic",
      },
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
    });

    expect(choices.map((choice) => choice.sourceDefinition.cardNo)).toEqual([
      "TEST-P3-76-SOURCE-EFFECTIVE-TRIBE-RESPONDER",
    ]);
  });

  it('engine-exhaust-provenance-skip-refresh: whose-gap 修正により player:"opponent" + event:"exhaust" の第三者観測が isSelf 誤判定でブロックされない', () => {
    // BSLH01-C04 型「自分の効果で疲労した相手の…」相当。exhaust の pendingEffect は
    // actingPlayerId/relatedPlayerId に「疲労した側 (対象カードのコントローラ)」を積む
    // (collectTriggerEventsFromStateDelta)。listener (alice) は対象を疲労させた側で
    // コントローラが一致しないため、whose 既定 "self" のままだと
    // isSelf=(listener.controller===actingPlayerId)=false で誤ブロックされていた
    // (reduce_life と同型の whose-gap、2026-07-19 発見)。
    const listenerDef: CardDefinition = {
      ...makeDef("TEST-EXHAUST-WHOSE-GAP-LISTENER", "spirit"),
      effects: [
        {
          timing: {
            kind: "game_event",
            player: "opponent",
            event: "exhaust",
            triggerFilter: { category: ["spirit"] },
          },
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        },
      ],
    };
    const targetDef = makeDef("TEST-EXHAUST-WHOSE-GAP-TARGET", "spirit");
    const definitions = [listenerDef, targetDef];
    const lookup = makeLookup(definitions);
    const listener = createCardInstance(listenerDef, {
      instanceId: "exhaust-whose-gap-listener",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "exhaust-whose-gap-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [listener, target],
    });

    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: {
        pendingId: "exhaust-whose-gap-pending",
        actingPlayerId: "bob",
        eventKind: "exhaust",
        source: "action_resolution",
        chainId: "test:trigger-system:2978",
        attackId: null,
        relatedPlayerId: "bob",
        relatedInstanceId: "exhaust-whose-gap-target",
        amount: null,
        step: "attack",
        window: "default",
        resolvedSourceInstanceIds: [],
      },
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
    });

    expect(choices.map((choice) => choice.sourceDefinition.cardNo)).toEqual([
      "TEST-EXHAUST-WHOSE-GAP-LISTENER",
    ]);
  });

  it("P3-76: 手札の BSDB01-M02 型 targeted 誘発も発揮元 payload を公開 pending まで保持する", () => {
    const responderDef = makeHandTargetedOptionalCountTriggerDef(
      "TEST-BSDB01-M02-HAND-TARGETED",
      { category: ["magic"] }
    );
    const magicDef = makeTargetedDestroyMagicDef("TEST-P3-76-HAND-MAGIC");
    const targetDef = makeDef("TEST-P3-76-HAND-TARGET", "spirit");
    const definitions = [responderDef, magicDef, targetDef];
    const lookup = makeLookup(definitions);
    const handResponder = createCardInstance(responderDef, {
      instanceId: "bsdb01-m02-hand-responder",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const target = createCardInstance(targetDef, {
      instanceId: "targeted-hand-field-card",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "p3-76-hand-magic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [handResponder, target, magic],
    });
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(definitions),
    };

    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [
        {
          eventKind: "targeted",
          actingPlayerId: "bob",
          source: "action_resolution",
          chainId: "chain:p3-76-hand-targeted",
          attackId: null,
          relatedPlayerId: "bob",
          relatedInstanceId: "targeted-hand-field-card",
          amount: 1,
          effectSourceInstanceId: "p3-76-hand-magic",
          effectSourceDefinitionId: "TEST-P3-76-HAND-MAGIC",
          effectActionKind: "magic",
        },
      ],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions:
          effectLookups.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: effectLookups.getRegisteredBurstActions,
      }
    );

    expect(queued.pendingTriggeredEffects).toHaveLength(0);
    expect(queued.pendingPrivateDeclarations).toHaveLength(1);
    expect(queued.pendingPrivateDeclarations[0]).toMatchObject({
      eventKind: "targeted",
      sourceInstanceId: "bsdb01-m02-hand-responder",
      effectSourceInstanceId: "p3-76-hand-magic",
      effectSourceDefinitionId: "TEST-P3-76-HAND-MAGIC",
      effectActionKind: "magic",
    });

    const declareAction = getLegalActions({
      state: queued,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "declare_private_triggered_effect");
    expect(declareAction).toBeDefined();

    const declared = applyLegalAction({
      state: queued,
      action: declareAction!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;

    expect(declared.pendingPrivateDeclarations).toHaveLength(0);
    expect(declared.pendingTriggeredEffects).toHaveLength(1);
    expect(declared.pendingTriggeredEffects[0]).toMatchObject({
      eventKind: "targeted",
      declaredFromPrivateZone: true,
      declaredSourceInstanceId: "bsdb01-m02-hand-responder",
      effectSourceInstanceId: "p3-76-hand-magic",
      effectSourceDefinitionId: "TEST-P3-76-HAND-MAGIC",
      effectActionKind: "magic",
    });
  });

  it("P3-76: hand-written resolver も対象確定後・本体前に targeted disclosure を挟んで再開する", () => {
    const responderDef = makeTargetedOptionalCountTriggerDef(
      "TEST-BSDB01-M02-TARGETED-HANDWRITTEN",
      { category: ["magic"] }
    );
    const magicDef = {
      ...makeDef("TEST-P3-76-HANDWRITTEN-MAGIC", "magic"),
      levelDefs: [],
      symbolColors: [],
      textLines: [
        "相手のスピリット1体を対象にし、手書き resolver でカウントを増やす。",
      ],
    };
    const targetDef = makeDef("TEST-P3-76-HANDWRITTEN-TARGET", "spirit");
    const definitions = [responderDef, magicDef, targetDef];
    const lookup = makeLookup(definitions);
    const responder = createCardInstance(responderDef, {
      instanceId: "targeted-handwritten-responder",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "targeted-handwritten-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "p3-76-handwritten-magic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 0 }, { countValue: 0 }],
        cardInstances: [responder, target, magic],
      }),
      activePlayerId: "alice",
      step: "attack" as const,
    };
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(definitions),
    };
    const getHandWrittenEffectResolver = (cardNo: string) =>
      cardNo === magicDef.cardNo
        ? (current: GameState) => ({
            ...current,
            players: current.players.map((player) =>
              player.id === "alice"
                ? { ...player, countValue: player.countValue + 1 }
                : player
            ),
            log: [...current.log, "hand-written:resolved"],
          })
        : undefined;

    const afterDisclosure = runActionMainResolution({
      state,
      chainId: "chain:p3-76-handwritten",
      startLogs: ["hand-written:start"],
      endLogs: ["hand-written:end"],
      context: {
        chainId: "chain:p3-76-handwritten",
        resolutionKind: "magic_action",
        actingPlayerId: "alice",
        sourceKind: "magic",
        sourceCard: magic,
        sourceDefinition: magicDef,
        targetInstanceIds: ["targeted-handwritten-target"],
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions:
          effectLookups.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: effectLookups.getRegisteredBurstActions,
        effectActionKind: "magic",
      },
      getHandWrittenEffectResolver,
    });

    expect(afterDisclosure.pendingTriggeredEffects).toHaveLength(1);
    expect(afterDisclosure.pendingTargetedDisclosureContinuation).toMatchObject(
      {
        targetInstanceIds: ["targeted-handwritten-target"],
        handWrittenResolution: {
          chainId: "chain:p3-76-handwritten",
          targetInstanceIds: ["targeted-handwritten-target"],
        },
      }
    );
    expect(
      afterDisclosure.players.find((player) => player.id === "alice")!
        .countValue
    ).toBe(0);

    const skipAction = getLegalActions({
      state: afterDisclosure,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "targeted-handwritten-responder"
    );
    expect(skipAction).toBeDefined();

    const afterResume = applyLegalAction({
      state: afterDisclosure,
      action: skipAction!,
      skipOptionalEffect: true,
      getCardDefinitionById: lookup,
      getHandWrittenEffectResolver,
      ...effectLookups,
    }).state;

    expect(afterResume.pendingTargetedDisclosureContinuation).toBeNull();
    expect(afterResume.pendingTriggeredEffects).toHaveLength(0);
    expect(
      afterResume.players.find((player) => player.id === "alice")!.countValue
    ).toBe(1);
    expect(afterResume.log).toContain("hand-written:resolved");
    expect(afterResume.log).toContain("hand-written:end");
  });

  it("P3-76: hand-written resolver 再開は redirect 後の continuation target を正源にする", () => {
    const responderDef = {
      ...makeDef("TEST-P3-76-HANDWRITTEN-REDIRECT-RESPONDER", "spirit"),
      textLines: ["対象になったとき、元効果の対象をこのスピリットのみにする。"],
      effects: [
        {
          timing: {
            kind: "game_event" as const,
            event: "targeted" as const,
            player: "self" as const,
          },
          executionMode: "mandatory" as const,
          steps: [
            {
              action: {
                kind: "redirect_target" as const,
                from: { kind: "trigger_related_instance" as const },
                to: { kind: "self" as const },
                mode: "all_current_effect_targets" as const,
              },
            },
          ],
        },
      ],
    };
    const magicDef = {
      ...makeDef("TEST-P3-76-HANDWRITTEN-REDIRECT-MAGIC", "magic"),
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手のスピリット1体を対象にする手書き resolver。"],
    };
    const targetDef = makeDef(
      "TEST-P3-76-HANDWRITTEN-REDIRECT-TARGET",
      "spirit"
    );
    const definitions = [responderDef, magicDef, targetDef];
    const lookup = makeLookup(definitions);
    const responder = createCardInstance(responderDef, {
      instanceId: "targeted-handwritten-redirect-responder",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "targeted-handwritten-redirect-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "p3-76-handwritten-redirect-magic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [responder, target, magic],
      }),
      activePlayerId: "alice",
      step: "attack" as const,
    };
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(definitions),
    };
    const getHandWrittenEffectResolver = (cardNo: string) =>
      cardNo === magicDef.cardNo
        ? (current: GameState, context: { targetInstanceIds: string[] }) => ({
            ...current,
            log: [
              ...current.log,
              `hand-written:targets:${context.targetInstanceIds.join(",")}`,
            ],
          })
        : undefined;

    const afterDisclosure = runActionMainResolution({
      state,
      chainId: "chain:p3-76-handwritten-redirect",
      startLogs: ["hand-written-redirect:start"],
      endLogs: ["hand-written-redirect:end"],
      context: {
        chainId: "chain:p3-76-handwritten-redirect",
        resolutionKind: "magic_action",
        actingPlayerId: "alice",
        sourceKind: "magic",
        sourceCard: magic,
        sourceDefinition: magicDef,
        targetInstanceIds: ["targeted-handwritten-redirect-target"],
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions:
          effectLookups.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: effectLookups.getRegisteredBurstActions,
        effectActionKind: "magic",
      },
      getHandWrittenEffectResolver,
    });

    expect(afterDisclosure.pendingTargetedDisclosureContinuation).toMatchObject(
      {
        targetInstanceIds: ["targeted-handwritten-redirect-target"],
        handWrittenResolution: {
          targetInstanceIds: ["targeted-handwritten-redirect-target"],
        },
      }
    );

    const resolveResponder = getLegalActions({
      state: afterDisclosure,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "targeted-handwritten-redirect-responder"
    );
    expect(resolveResponder).toBeDefined();

    const afterResponderDeclared = applyLegalAction({
      state: afterDisclosure,
      action: resolveResponder!,
      getCardDefinitionById: lookup,
      getHandWrittenEffectResolver,
      ...effectLookups,
    }).state;
    const passStack = getLegalActions({
      state: afterResponderDeclared,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(passStack).toBeDefined();

    const afterResume = applyLegalAction({
      state: afterResponderDeclared,
      action: passStack!,
      getCardDefinitionById: lookup,
      getHandWrittenEffectResolver,
      ...effectLookups,
    }).state;

    expect(afterResume.pendingTargetedDisclosureContinuation).toBeNull();
    expect(afterResume.log).toContain(
      "effect:redirect_target:targeted-disclosure:targeted-handwritten-redirect-target->targeted-handwritten-redirect-responder"
    );
    expect(afterResume.log).toContain(
      "hand-written:targets:targeted-handwritten-redirect-responder"
    );
  });

  it("P3-76: all_current_effect_targets は元対象が残っていない後続 responder で再 redirect しない", () => {
    const responderDef = {
      ...makeDef("TEST-P3-76-REDIRECT-NOOP-RESPONDER", "spirit"),
      textLines: ["対象になったとき、元効果の対象をこのスピリットのみにする。"],
      effects: [
        {
          timing: {
            kind: "game_event" as const,
            event: "targeted" as const,
            player: "self" as const,
          },
          executionMode: "mandatory" as const,
          steps: [
            {
              action: {
                kind: "redirect_target" as const,
                from: { kind: "trigger_related_instance" as const },
                to: { kind: "self" as const },
                mode: "all_current_effect_targets" as const,
              },
            },
          ],
        },
      ],
    };
    const originalTargetDef = makeDef(
      "TEST-P3-76-REDIRECT-NOOP-ORIGINAL",
      "spirit"
    );
    const magicDef = makeDef("TEST-P3-76-REDIRECT-NOOP-MAGIC", "magic");
    const definitions = [responderDef, originalTargetDef, magicDef];
    const lookup = makeLookup(definitions);
    const originalTarget = createCardInstance(originalTargetDef, {
      instanceId: "redirect-noop-original-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const firstResponder = createCardInstance(responderDef, {
      instanceId: "redirect-noop-first-responder",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const secondResponder = createCardInstance(responderDef, {
      instanceId: "redirect-noop-second-responder",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "redirect-noop-magic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [originalTarget, firstResponder, secondResponder, magic],
      }),
      pendingTargetedDisclosureContinuation: {
        chainId: "test:trigger-system:3476",
        pendingId: "targeted-disclosure:redirect-noop",
        sourceDefinitionId: magicDef.cardNo,
        effectIndex: 0,
        sourceInstanceId: "redirect-noop-magic",
        effectActionKind: "magic",
        actingPlayerId: "alice",
        resumeStepIndex: 0,
        stepContext: { results: {} },
        targetInstanceIds: ["redirect-noop-first-responder"],
        targetStepId: "__step_0",
        remainingStacks: [],
      },
    };

    const after = executeEffect({
      state,
      effect: responderDef.effects![0]!,
      sourceInstanceId: "redirect-noop-second-responder",
      actingPlayerId: "bob",
      chainId: "chain:redirect-noop-second",
      triggerRelatedInstanceId: "redirect-noop-original-target",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });

    expect(
      after.pendingTargetedDisclosureContinuation?.targetInstanceIds
    ).toEqual(["redirect-noop-first-responder"]);
    expect(
      after.log.some((entry) =>
        entry.startsWith("effect:redirect_target:targeted-disclosure:")
      )
    ).toBe(false);
  });

  it("P3-76: all_current_effect_targets は同時指定されたフィールド対象だけを畳み、手札対象を維持する", () => {
    const responderDef = {
      ...makeDef("TEST-P3-76-REDIRECT-FIELD-ONLY-RESPONDER", "spirit"),
      textLines: ["対象になったとき、元効果の対象をこのスピリットのみにする。"],
      effects: [
        {
          timing: {
            kind: "game_event" as const,
            event: "targeted" as const,
            player: "self" as const,
          },
          executionMode: "mandatory" as const,
          steps: [
            {
              action: {
                kind: "redirect_target" as const,
                from: { kind: "trigger_related_instance" as const },
                to: { kind: "self" as const },
                mode: "all_current_effect_targets" as const,
              },
            },
          ],
        },
      ],
    };
    const fieldSpiritDef = makeDef(
      "TEST-P3-76-REDIRECT-FIELD-SPIRIT",
      "spirit"
    );
    const fieldNexusDef = makeDef("TEST-P3-76-REDIRECT-FIELD-NEXUS", "nexus");
    const fieldTokenDef = makeDef("TEST-P3-76-REDIRECT-FIELD-TOKEN", "magic");
    const handSpiritDef = makeDef("TEST-P3-76-REDIRECT-HAND-SPIRIT", "spirit");
    const magicDef = makeDef("TEST-P3-76-REDIRECT-FIELD-ONLY-MAGIC", "magic");
    const definitions = [
      responderDef,
      fieldSpiritDef,
      fieldNexusDef,
      fieldTokenDef,
      handSpiritDef,
      magicDef,
    ];
    const lookup = makeLookup(definitions);
    const originalFieldTarget = createCardInstance(fieldSpiritDef, {
      instanceId: "redirect-field-only-original",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const fieldNexusTarget = createCardInstance(fieldNexusDef, {
      instanceId: "redirect-field-only-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const fieldActAsSpiritTarget = createCardInstance(fieldTokenDef, {
      instanceId: "redirect-field-only-act-as-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const handTarget = createCardInstance(handSpiritDef, {
      instanceId: "redirect-field-only-hand",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const responder = createCardInstance(responderDef, {
      instanceId: "redirect-field-only-responder",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "redirect-field-only-magic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          originalFieldTarget,
          fieldNexusTarget,
          fieldActAsSpiritTarget,
          handTarget,
          responder,
          magic,
        ],
      }),
      activeContinuousEffects: [
        {
          effectId: "ce-redirect-field-only-act-as-spirit",
          sourceInstanceId: "redirect-field-only-magic",
          sourceDefinitionId: magicDef.cardNo,
          actingPlayerId: "alice",
          duration: { scope: "turn" as const },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "act_as_spirit" as const,
          targetInstanceId: "redirect-field-only-act-as-spirit",
          metadata: {},
        } satisfies ContinuousEffect,
      ],
      pendingTargetedDisclosureContinuation: {
        chainId: "test:trigger-system:3621",
        pendingId: "targeted-disclosure:redirect-field-only",
        sourceDefinitionId: magicDef.cardNo,
        effectIndex: 0,
        sourceInstanceId: "redirect-field-only-magic",
        effectActionKind: "magic",
        actingPlayerId: "alice",
        resumeStepIndex: 0,
        stepContext: { results: {} },
        targetInstanceIds: [
          "redirect-field-only-original",
          "redirect-field-only-nexus",
          "redirect-field-only-act-as-spirit",
          "redirect-field-only-hand",
        ],
        targetCandidateInstanceIds: ["redirect-field-only-responder"],
        targetStepId: "__step_0",
        remainingStacks: [],
      },
    };

    const after = executeEffect({
      state,
      effect: responderDef.effects![0]!,
      sourceInstanceId: "redirect-field-only-responder",
      actingPlayerId: "bob",
      chainId: "chain:redirect-field-only",
      triggerRelatedInstanceId: "redirect-field-only-original",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });

    expect(
      after.pendingTargetedDisclosureContinuation?.targetInstanceIds
    ).toEqual(["redirect-field-only-responder", "redirect-field-only-hand"]);
    expect(after.log).toContain(
      "effect:redirect_target:targeted-disclosure:redirect-field-only-original,redirect-field-only-nexus,redirect-field-only-act-as-spirit,redirect-field-only-hand->redirect-field-only-responder,redirect-field-only-hand"
    );
  });

  it("P3-76: 通常 DSL disclosure でも元効果候補外への対象変更を拒否する", () => {
    const responderDef = {
      ...makeDef("TEST-P3-76-REDIRECT-DSL-CANDIDATE-RESPONDER", "spirit"),
      textLines: ["対象になったとき、元効果の対象をこのスピリットのみにする。"],
      effects: [
        {
          timing: {
            kind: "game_event" as const,
            event: "targeted" as const,
            player: "self" as const,
          },
          executionMode: "mandatory" as const,
          steps: [
            {
              action: {
                kind: "redirect_target" as const,
                from: { kind: "trigger_related_instance" as const },
                to: { kind: "self" as const },
                mode: "all_current_effect_targets" as const,
              },
            },
          ],
        },
      ],
    };
    const targetDef = {
      ...makeDef("TEST-P3-76-REDIRECT-DSL-CANDIDATE-TARGET", "spirit"),
      name: "Original Shadow",
    };
    const magicDef: CardDefinition = {
      ...makeDef("TEST-P3-76-REDIRECT-DSL-CANDIDATE-MAGIC", "magic"),
      levelDefs: [],
      symbolColors: [],
      effects: [
        {
          timing: { kind: "activated" as const, mode: "flash" as const },
          steps: [
            {
              action: {
                kind: "destroy" as const,
                target: {
                  kind: "filter" as const,
                  player: "opponent" as const,
                  filter: {
                    category: ["spirit" as const],
                    cardName: { contains: "Original Shadow" },
                  },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
    const definitions = [responderDef, targetDef, magicDef];
    const lookup = makeLookup(definitions);
    const originalTarget = createCardInstance(targetDef, {
      instanceId: "redirect-dsl-candidate-original",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const responder = createCardInstance(responderDef, {
      instanceId: "redirect-dsl-candidate-responder",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "redirect-dsl-candidate-magic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [originalTarget, responder, magic],
    });

    const afterDisclosure = executeEffect({
      state,
      effect: magicDef.effects![0]!,
      sourceInstanceId: "redirect-dsl-candidate-magic",
      actingPlayerId: "alice",
      chainId: "chain:redirect-dsl-candidate",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: () => [],
    });

    expect(afterDisclosure.pendingTargetedDisclosureContinuation).toMatchObject(
      {
        targetInstanceIds: ["redirect-dsl-candidate-original"],
        targetCandidateInstanceIds: ["redirect-dsl-candidate-original"],
      }
    );

    const afterRedirectAttempt = executeEffect({
      state: afterDisclosure,
      effect: responderDef.effects![0]!,
      sourceInstanceId: "redirect-dsl-candidate-responder",
      actingPlayerId: "bob",
      chainId: "chain:redirect-dsl-candidate-responder",
      triggerRelatedInstanceId: "redirect-dsl-candidate-original",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });

    expect(
      afterRedirectAttempt.pendingTargetedDisclosureContinuation
        ?.targetInstanceIds
    ).toEqual(["redirect-dsl-candidate-original"]);
    expect(
      afterRedirectAttempt.log.some((entry) =>
        entry.startsWith("effect:redirect_target:targeted-disclosure:")
      )
    ).toBe(false);
  });

  it("P3-76: 対象変更先が元効果の合法候補外なら targeted disclosure の対象を変更しない", () => {
    const responderDef = {
      ...makeDef("TEST-P3-76-REDIRECT-CANDIDATE-GATE-RESPONDER", "spirit"),
      textLines: ["対象になったとき、元効果の対象をこのスピリットのみにする。"],
      effects: [
        {
          timing: {
            kind: "game_event" as const,
            event: "targeted" as const,
            player: "self" as const,
          },
          executionMode: "mandatory" as const,
          steps: [
            {
              action: {
                kind: "redirect_target" as const,
                from: { kind: "trigger_related_instance" as const },
                to: { kind: "self" as const },
                mode: "all_current_effect_targets" as const,
              },
            },
          ],
        },
      ],
    };
    const targetDef = makeDef(
      "TEST-P3-76-REDIRECT-CANDIDATE-GATE-TARGET",
      "spirit"
    );
    const magicDef = makeDef(
      "TEST-P3-76-REDIRECT-CANDIDATE-GATE-MAGIC",
      "magic"
    );
    const definitions = [responderDef, targetDef, magicDef];
    const lookup = makeLookup(definitions);
    const originalTarget = createCardInstance(targetDef, {
      instanceId: "redirect-candidate-gate-original",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const responder = createCardInstance(responderDef, {
      instanceId: "redirect-candidate-gate-responder",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "redirect-candidate-gate-magic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [originalTarget, responder, magic],
      }),
      pendingTargetedDisclosureContinuation: {
        chainId: "test:trigger-system:3846",
        pendingId: "targeted-disclosure:redirect-candidate-gate",
        sourceDefinitionId: magicDef.cardNo,
        effectIndex: 0,
        sourceInstanceId: "redirect-candidate-gate-magic",
        effectActionKind: "magic",
        actingPlayerId: "alice",
        resumeStepIndex: 0,
        stepContext: { results: {} },
        targetInstanceIds: ["redirect-candidate-gate-original"],
        targetCandidateInstanceIds: ["redirect-candidate-gate-original"],
        targetStepId: "__step_0",
        remainingStacks: [],
      },
    };

    const after = executeEffect({
      state,
      effect: responderDef.effects![0]!,
      sourceInstanceId: "redirect-candidate-gate-responder",
      actingPlayerId: "bob",
      chainId: "chain:redirect-candidate-gate",
      triggerRelatedInstanceId: "redirect-candidate-gate-original",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });

    expect(
      after.pendingTargetedDisclosureContinuation?.targetInstanceIds
    ).toEqual(["redirect-candidate-gate-original"]);
    expect(
      after.log.some((entry) =>
        entry.startsWith("effect:redirect_target:targeted-disclosure:")
      )
    ).toBe(false);
  });

  it("detects hand increase (draw)", () => {
    const before = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [],
      }),
      players: [
        {
          id: "alice",
          deckCount: 30,
          handCount: 4,
          lifeNormalCoreCount: 5,
          reserveNormalCoreCount: 3,
          trashNormalCoreCount: 0,
          voidNormalCoreCount: 188,
          soulCoreLocation: null,
          reserveSoulCoreCount: 0,
          trashSoulCoreCount: 0,
          lifeSoulCoreCount: 0,
        },
        {
          id: "bob",
          deckCount: 30,
          handCount: 4,
          lifeNormalCoreCount: 5,
          reserveNormalCoreCount: 3,
          trashNormalCoreCount: 0,
          voidNormalCoreCount: 188,
          soulCoreLocation: null,
          reserveSoulCoreCount: 0,
          trashSoulCoreCount: 0,
          lifeSoulCoreCount: 0,
        },
      ],
    } as GameState;

    const after = {
      ...before,
      players: [
        { ...before.players[0]!, handCount: 6, deckCount: 28 },
        before.players[1]!,
      ],
    } as GameState;

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: null,
      attackId: null,
    });

    const handEvents = events.filter((e) => e.eventKind === "increase_hand");
    expect(handEvents.length).toBe(1);
    expect(handEvents[0]!.relatedPlayerId).toBe("alice");
    expect(handEvents[0]!.amount).toBe(2);
  });

  it("returns empty array when no changes", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [],
    });
    const events = collectTriggerEventsFromStateDelta({
      beforeState: state as GameState,
      afterState: state as GameState,
      source: "action_resolution",
      chainId: null,
      attackId: null,
    });
    expect(events.length).toBe(0);
  });

  it("detects effect summon when a soul-state field card leaves soul state without zone delta", () => {
    const card = createCardInstance(makeDef("soul-summon"), {
      instanceId: "soul-summon",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [card],
      playerOverrides: [{ soulStateInstanceIds: ["soul-summon"] }, {}],
    }) as GameState;
    const after = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [{ ...card, normalCoreCount: 1 }],
        playerOverrides: [{ soulStateInstanceIds: [] }, {}],
      }),
      log: [
        ...before.log,
        "effect:summon:soul-summon:self:soul_state:cost=0:cores=1",
      ],
    } as GameState;

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: "soul-chain",
      attackId: null,
      enterFieldCausedByPlayerId: "alice",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        eventKind: "summon",
        relatedInstanceId: "soul-summon",
        cause: "self_effect",
        fromZone: "field",
      })
    );
  });

  it("detects effect placement when a soul-state field nexus is placed without zone delta", () => {
    const card = createCardInstance(makeDef("soul-place", "nexus"), {
      instanceId: "soul-place",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [card],
      playerOverrides: [{ soulStateInstanceIds: ["soul-place"] }, {}],
    }) as GameState;
    const after = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [card],
        playerOverrides: [{ soulStateInstanceIds: [] }, {}],
      }),
      log: [
        ...before.log,
        "effect:field_place:self:alice:soul-place:from=soul_state:cost=0:cores=0",
      ],
    } as GameState;

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: "soul-chain",
      attackId: null,
      enterFieldCausedByPlayerId: "alice",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        eventKind: "place",
        relatedInstanceId: "soul-place",
        cause: "self_effect",
        fromZone: "field",
      })
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        eventKind: "summon",
        relatedInstanceId: "soul-place",
      })
    );
  });

  it("detects soul_state_to_spirit_state when a soul-state card becomes an uncombined field spirit", () => {
    const card = createCardInstance(makeDef("soul-leave"), {
      instanceId: "soul-leave",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [card],
      playerOverrides: [{ soulStateInstanceIds: ["soul-leave"] }, {}],
    }) as GameState;
    const after = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [card],
      playerOverrides: [{ soulStateInstanceIds: [] }, {}],
    }) as GameState;

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: "leave-soul-chain",
      attackId: null,
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        eventKind: "soul_state_to_spirit_state",
        relatedPlayerId: "alice",
        relatedInstanceId: "soul-leave",
      })
    );
  });

  it("does not detect soul_state_to_spirit_state when a soul-state card leaves by becoming attached as a brave", () => {
    const brave = createCardInstance(makeDef("soul-brave", "spirit"), {
      instanceId: "soul-brave",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 0,
    });
    const host = createCardInstance(makeDef("host"), {
      instanceId: "host",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [brave, host],
      playerOverrides: [{ soulStateInstanceIds: ["soul-brave"] }, {}],
    }) as GameState;
    const after = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        { ...brave, attachedToInstanceId: "host" },
        { ...host, attachedChildrenIds: ["soul-brave"] },
      ],
      playerOverrides: [{ soulStateInstanceIds: [] }, {}],
    }) as GameState;

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: "combine-chain",
      attackId: null,
    });

    expect(events).not.toContainEqual(
      expect.objectContaining({
        eventKind: "soul_state_to_spirit_state",
        relatedInstanceId: "soul-brave",
      })
    );
  });

  // ----- P3-14 C-3: 状態変化トリガー (exhaust / recover) -----

  it("detects exhaust event when recovered → exhausted", () => {
    const before = createCardInstance(makeDef("e1"), {
      instanceId: "e1",
      ownerPlayerId: "alice",
      zone: "field",
      exhaustState: "recovered",
    });
    const after = { ...before, exhaustState: "exhausted" as const };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [before],
      }) as GameState,
      afterState: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [after],
      }) as GameState,
      source: "action_resolution",
      chainId: null,
      attackId: null,
    });

    const exhaustEvents = events.filter((e) => e.eventKind === "exhaust");
    expect(exhaustEvents.length).toBe(1);
    expect(exhaustEvents[0]!.relatedInstanceId).toBe("e1");
    expect(exhaustEvents[0]!.actingPlayerId).toBe("alice");
  });

  it("detects exhaust event when recovered → heavily_exhausted", () => {
    const before = createCardInstance(makeDef("e1"), {
      instanceId: "e1",
      ownerPlayerId: "alice",
      zone: "field",
      exhaustState: "recovered",
    });
    const after = { ...before, exhaustState: "heavily_exhausted" as const };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [before],
      }) as GameState,
      afterState: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [after],
      }) as GameState,
      source: "action_resolution",
      chainId: null,
      attackId: null,
    });

    expect(events.filter((e) => e.eventKind === "exhaust").length).toBe(1);
  });

  it("detects recover event when exhausted → recovered", () => {
    const before = createCardInstance(makeDef("r1"), {
      instanceId: "r1",
      ownerPlayerId: "alice",
      zone: "field",
      exhaustState: "exhausted",
    });
    const after = { ...before, exhaustState: "recovered" as const };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [before],
      }) as GameState,
      afterState: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [after],
      }) as GameState,
      source: "action_resolution",
      chainId: null,
      attackId: null,
    });

    const recoverEvents = events.filter((e) => e.eventKind === "recover");
    expect(recoverEvents.length).toBe(1);
    expect(recoverEvents[0]!.relatedInstanceId).toBe("r1");
    expect(recoverEvents[0]!.actingPlayerId).toBe("alice");
  });

  it("detects recover event when heavily_exhausted → exhausted", () => {
    const before = createCardInstance(makeDef("r1"), {
      instanceId: "r1",
      ownerPlayerId: "alice",
      zone: "field",
      exhaustState: "heavily_exhausted",
    });
    const after = { ...before, exhaustState: "exhausted" as const };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [before],
      }) as GameState,
      afterState: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [after],
      }) as GameState,
      source: "action_resolution",
      chainId: null,
      attackId: null,
    });

    expect(events.filter((e) => e.eventKind === "recover").length).toBe(1);
  });

  it("detects recover event when heavily_exhausted → recovered", () => {
    const before = createCardInstance(makeDef("r1"), {
      instanceId: "r1",
      ownerPlayerId: "alice",
      zone: "field",
      exhaustState: "heavily_exhausted",
    });
    const after = { ...before, exhaustState: "recovered" as const };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [before],
      }) as GameState,
      afterState: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [after],
      }) as GameState,
      source: "action_resolution",
      chainId: null,
      attackId: null,
    });

    expect(events.filter((e) => e.eventKind === "recover").length).toBe(1);
  });

  it("does not emit recover event when exhaustState unchanged", () => {
    const card = createCardInstance(makeDef("n1"), {
      instanceId: "n1",
      ownerPlayerId: "alice",
      zone: "field",
      exhaustState: "exhausted",
    });

    const events = collectTriggerEventsFromStateDelta({
      beforeState: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [card],
      }) as GameState,
      afterState: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [card],
      }) as GameState,
      source: "action_resolution",
      chainId: null,
      attackId: null,
    });

    expect(
      events.filter(
        (e) => e.eventKind === "exhaust" || e.eventKind === "recover"
      ).length
    ).toBe(0);
  });

  it("does not emit recover event for non-field card", () => {
    const before = createCardInstance(makeDef("h1"), {
      instanceId: "h1",
      ownerPlayerId: "alice",
      zone: "hand",
      exhaustState: "exhausted",
    });
    const after = { ...before, exhaustState: "recovered" as const };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [before],
      }) as GameState,
      afterState: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [after],
      }) as GameState,
      source: "action_resolution",
      chainId: null,
      attackId: null,
    });

    expect(events.filter((e) => e.eventKind === "recover").length).toBe(0);
  });

  it("emits both exhaust and recover events when multiple cards change in opposite directions", () => {
    const a = createCardInstance(makeDef("a1"), {
      instanceId: "a1",
      ownerPlayerId: "alice",
      zone: "field",
      exhaustState: "recovered",
    });
    const b = createCardInstance(makeDef("b1"), {
      instanceId: "b1",
      ownerPlayerId: "alice",
      zone: "field",
      exhaustState: "exhausted",
    });
    const aAfter = { ...a, exhaustState: "exhausted" as const };
    const bAfter = { ...b, exhaustState: "recovered" as const };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [a, b],
      }) as GameState,
      afterState: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [aAfter, bAfter],
      }) as GameState,
      source: "action_resolution",
      chainId: null,
      attackId: null,
    });

    expect(events.filter((e) => e.eventKind === "exhaust").length).toBe(1);
    expect(events.filter((e) => e.eventKind === "recover").length).toBe(1);
    expect(
      events.find((e) => e.eventKind === "exhaust")?.relatedInstanceId
    ).toBe("a1");
    expect(
      events.find((e) => e.eventKind === "recover")?.relatedInstanceId
    ).toBe("b1");
  });
});

describe("triggerEventKindToStructuredEvent (recover)", () => {
  it("maps recover to state_change family with require_related_instance_on_field", () => {
    const event = triggerEventKindToStructuredEvent("recover");
    expect(event.family).toBe("state_change");
    expect(event.validationMode).toBe("require_related_instance_on_field");
  });

  it("recover event matches { family: state_change } matcher", () => {
    const matcher: TriggerEventMatcher = { family: "state_change" };
    const event: StructuredTriggerEvent =
      triggerEventKindToStructuredEvent("recover");
    expect(matchesTriggerEvent(matcher, event)).toBe(true);
  });
});

describe("queuePendingReactionsFromTriggerEvents - simultaneousGroupId 付与", () => {
  it("同時誘発バッチ (events.length>=2) は pendingTriggeredEffect / pendingBurstCheck 双方に同一 groupId を付与", () => {
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [],
    });

    // 同時破壊: s1 と s2 が destroy される
    const events = [
      {
        eventKind: "destroy" as const,
        actingPlayerId: "alice",
        source: "action_resolution" as const,
        chainId: "test:trigger-system:4390",
        attackId: null,
        relatedPlayerId: "bob",
        relatedInstanceId: "s1",
        amount: null,
      },
      {
        eventKind: "destroy" as const,
        actingPlayerId: "alice",
        source: "action_resolution" as const,
        chainId: "test:trigger-system:4400",
        attackId: null,
        relatedPlayerId: "bob",
        relatedInstanceId: "s2",
        amount: null,
      },
    ];

    const next = queuePendingReactionsRawForTesting(baseState, events);

    expect(next.pendingTriggeredEffects).toHaveLength(2);
    expect(next.pendingBurstChecks).toHaveLength(2);

    // 全 pending が同一 groupId を持つ
    const peGroupIds = next.pendingTriggeredEffects.map(
      (pe) => pe.simultaneousGroupId
    );
    const bcGroupIds = next.pendingBurstChecks.map(
      (bc) => bc.simultaneousGroupId
    );
    expect(peGroupIds[0]).toBeDefined();
    expect(peGroupIds[0]).toBe(peGroupIds[1]);
    expect(bcGroupIds[0]).toBeDefined();
    expect(bcGroupIds[0]).toBe(bcGroupIds[1]);
    // pe と bc も同じ groupId を共有する（stay_on_field の連動撤回が機能するため）
    expect(peGroupIds[0]).toBe(bcGroupIds[0]);
  });

  it("単発イベント (events.length=1) には groupId は付与されない", () => {
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [],
    });

    const events = [
      {
        eventKind: "destroy" as const,
        actingPlayerId: "alice",
        source: "action_resolution" as const,
        chainId: "test:trigger-system:4439",
        attackId: null,
        relatedPlayerId: "bob",
        relatedInstanceId: "s1",
        amount: null,
      },
    ];

    const next = queuePendingReactionsRawForTesting(baseState, events);

    expect(
      next.pendingTriggeredEffects[0]?.simultaneousGroupId
    ).toBeUndefined();
    expect(next.pendingBurstChecks[0]?.simultaneousGroupId).toBeUndefined();
  });

  it("同一収集境界の複数 after_draw occurrence は amount を合算して1 pendingにする", () => {
    const drawListenerDef = makeAfterDrawOptionalCountTriggerDef(
      "TEST-AFTER-DRAW-LISTENER"
    );
    const definitions = [drawListenerDef];
    const lookup = makeLookup(definitions);
    const drawListener = createCardInstance(drawListenerDef, {
      instanceId: "after-draw-listener",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [drawListener],
    });
    const after = {
      ...before,
      players: before.players.map((player) =>
        player.id === "alice"
          ? {
              ...player,
              handCount: player.handCount + 2,
              deckCount: player.deckCount - 2,
            }
          : player
      ),
      pendingDrawEvents: [
        { playerId: "alice", amount: 1 },
        { playerId: "alice", amount: 1 },
      ],
    };

    const next = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: "draw-effect",
      attackId: null,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      causedByPlayerId: "alice",
    });

    const drawPendings = next.pendingTriggeredEffects.filter(
      (pending) => pending.eventKind === "after_draw"
    );
    expect(drawPendings).toHaveLength(1);
    expect(drawPendings[0]?.amount).toBe(2);
  });

  it("after_triggers 境界後の after_draw は別 pending として保持する", () => {
    const drawListenerDef = makeAfterDrawOptionalCountTriggerDef(
      "TEST-AFTER-DRAW-LISTENER"
    );
    const definitions = [drawListenerDef];
    const lookup = makeLookup(definitions);
    const drawListener = createCardInstance(drawListenerDef, {
      instanceId: "after-draw-listener",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [drawListener],
    });
    const afterFirstDraw = {
      ...before,
      players: before.players.map((player) =>
        player.id === "alice"
          ? {
              ...player,
              handCount: player.handCount + 1,
              deckCount: player.deckCount - 1,
            }
          : player
      ),
      pendingDrawEvents: [{ playerId: "alice", amount: 1 }],
    };
    const lookups = {
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
    };
    const firstQueued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: afterFirstDraw,
      source: "action_resolution",
      chainId: "draw-effect:after_triggers:1",
      attackId: null,
      ...lookups,
      causedByPlayerId: "alice",
    });
    const beforeSecondDraw = {
      ...firstQueued,
      players: firstQueued.players.map((player) =>
        player.id === "alice"
          ? {
              ...player,
              handCount: player.handCount,
              deckCount: player.deckCount,
            }
          : player
      ),
    };
    const afterSecondDraw = {
      ...beforeSecondDraw,
      players: beforeSecondDraw.players.map((player) =>
        player.id === "alice"
          ? {
              ...player,
              handCount: player.handCount + 1,
              deckCount: player.deckCount - 1,
            }
          : player
      ),
      pendingDrawEvents: [{ playerId: "alice", amount: 1 }],
    };

    const secondQueued = collectAndQueueTriggerReactions({
      beforeState: beforeSecondDraw,
      afterState: afterSecondDraw,
      source: "action_resolution",
      chainId: "draw-effect",
      attackId: null,
      ...lookups,
      causedByPlayerId: "alice",
    });

    expect(
      secondQueued.pendingTriggeredEffects.filter(
        (pending) => pending.eventKind === "after_draw"
      )
    ).toHaveLength(2);
  });

  it("同じ効果で2体同時召喚されたとき第三者の召喚時誘発は1 pendingに集約し関連2体を保持する", () => {
    const watcherDef = makeEffectSummonDrawTriggerDef(
      "TEST-EFFECT-SUMMON-WATCHER"
    );
    const summonedDef = makeDef("TEST-EFFECT-SUMMONED", "spirit");
    const definitions = [watcherDef, summonedDef];
    const lookup = makeLookup(definitions);
    const watcher = createCardInstance(watcherDef, {
      instanceId: "summon-watcher",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const summonedA = createCardInstance(summonedDef, {
      instanceId: "sp-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
    });
    const summonedB = createCardInstance(summonedDef, {
      instanceId: "sp-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [watcher, summonedA, summonedB],
    });
    const events = (["sp-a", "sp-b"] as const).map((instanceId) => ({
      eventKind: "summon" as const,
      actingPlayerId: "alice",
      source: "action_resolution" as const,
      chainId: "chain:multi-summon",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: instanceId,
      amount: null,
      cause: "self_effect" as const,
      fromZone: "hand" as const,
    }));

    const next = queuePendingReactionsFromTriggerEvents(
      state,
      events,
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(definitions),
        getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      }
    );

    const summonPendings = next.pendingTriggeredEffects.filter(
      (pending) => pending.eventKind === "summon"
    );
    expect(summonPendings).toHaveLength(1);
    expect(new Set(summonPendings[0]?.relatedInstanceIds ?? [])).toEqual(
      new Set(["sp-a", "sp-b"])
    );
    const relatedGroups = Object.values(
      summonPendings[0]?.relatedInstanceIdsBySourceRegistrationKey ?? {}
    ).map((ids) => [...ids].sort());
    expect(relatedGroups).toContainEqual(["sp-a", "sp-b"]);
  });

  it("同じ効果で2体同時召喚されても各カード自身の召喚時はそれぞれ誘発する", () => {
    const selfTriggerDef = makeSelfSummonDrawTriggerDef(
      "TEST-SELF-SUMMON-TRIGGER"
    );
    const definitions = [selfTriggerDef];
    const lookup = makeLookup(definitions);
    const summonedA = createCardInstance(selfTriggerDef, {
      instanceId: "self-sp-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
    });
    const summonedB = createCardInstance(selfTriggerDef, {
      instanceId: "self-sp-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [summonedA, summonedB],
    });
    const events = (["self-sp-a", "self-sp-b"] as const).map((instanceId) => ({
      eventKind: "summon" as const,
      actingPlayerId: "alice",
      source: "action_resolution" as const,
      chainId: "chain:multi-summon",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: instanceId,
      amount: null,
      cause: "self_effect" as const,
      fromZone: "hand" as const,
    }));

    const next = queuePendingReactionsFromTriggerEvents(
      state,
      events,
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(definitions),
        getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      }
    );

    expect(
      next.pendingTriggeredEffects.filter(
        (pending) => pending.eventKind === "summon"
      )
    ).toHaveLength(2);
  });

  it("効果場入り dedupe は chain が異なる summon pending を collapse しない", () => {
    const existing = queuePendingReactionsRawForTesting(
      createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [],
      }),
      [
        {
          eventKind: "summon" as const,
          actingPlayerId: "alice",
          source: "action_resolution" as const,
          chainId: "chain:1",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "ben",
          amount: null,
          cause: "self_effect" as const,
          fromZone: "trash" as const,
        },
      ]
    );

    const next = queuePendingReactionsRawForTesting(existing, [
      {
        eventKind: "summon" as const,
        actingPlayerId: "alice",
        source: "action_resolution" as const,
        chainId: "chain:2",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: "ben",
        amount: null,
        cause: "self_effect" as const,
        fromZone: "trash" as const,
      },
    ]);

    const summonPendings = next.pendingTriggeredEffects.filter(
      (pending) => pending.eventKind === "summon"
    );
    expect(summonPendings).toHaveLength(2);
    expect(summonPendings.map((pending) => pending.chainId)).toEqual([
      "chain:1",
      "chain:2",
    ]);
  });

  it("効果場入り dedupe は親 chain と after_triggers 派生 chain の再収集を collapse する", () => {
    const existing = queuePendingReactionsRawForTesting(
      createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [],
      }),
      [
        {
          eventKind: "summon" as const,
          actingPlayerId: "alice",
          source: "action_resolution" as const,
          chainId: "parent-chain:after_triggers:1",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "ben",
          amount: null,
          cause: "self_effect" as const,
          fromZone: "deck" as const,
        },
      ]
    );

    const next = queuePendingReactionsRawForTesting(existing, [
      {
        eventKind: "summon" as const,
        actingPlayerId: "alice",
        source: "action_resolution" as const,
        chainId: "parent-chain",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: "ben",
        amount: null,
        cause: "self_effect" as const,
        fromZone: "deck" as const,
      },
    ]);

    const summonPendings = next.pendingTriggeredEffects.filter(
      (pending) => pending.eventKind === "summon"
    );
    expect(summonPendings).toHaveLength(1);
    expect(summonPendings[0]?.chainId).toBe("parent-chain:after_triggers:1");
  });

  it("効果場入り dedupe は burst-only summon check の二重 queue を防ぐ", () => {
    const burstDef = makeOpponentSummonBurstDef("TEST-BURST-SUMMON");
    const summonedDef = makeDef("TEST-SUMMONED", "spirit");
    const definitions = [burstDef, summonedDef];
    const lookup = makeLookup(definitions);
    const burstCard = createCardInstance(burstDef, {
      instanceId: "alice-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const summonedCard = createCardInstance(summonedDef, {
      instanceId: "bob-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "bob",
      step: "main" as const,
      cardInstances: [burstCard, summonedCard],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "alice-burst" }],
    };
    const event = {
      eventKind: "summon" as const,
      actingPlayerId: "bob",
      source: "action_resolution" as const,
      chainId: "chain:effect-summon",
      attackId: null,
      relatedPlayerId: "bob",
      relatedInstanceId: "bob-spirit",
      amount: null,
      cause: "self_effect" as const,
      fromZone: "trash" as const,
    };
    const options = {
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
    };

    const first = queuePendingReactionsFromTriggerEvents(
      state,
      [event],
      undefined,
      options
    );
    const second = queuePendingReactionsFromTriggerEvents(
      first,
      [event],
      undefined,
      options
    );

    expect(first.pendingTriggeredEffects).toHaveLength(0);
    expect(first.pendingPrivateDeclarations).toHaveLength(0);
    expect(first.pendingBurstChecks).toHaveLength(1);
    expect(second.pendingBurstChecks).toHaveLength(1);
    expect(second.pendingBurstChecks[0]).toMatchObject({
      eventKind: "summon",
      chainId: "chain:effect-summon",
      relatedPlayerId: "bob",
      relatedInstanceId: "bob-spirit",
    });
  });

  it("効果場入り dedupe は private-only summon declaration の二重 queue を防ぐ", () => {
    const triggerDef = makeOptionalHandSummonTriggerDef("TEST-HAND-TRIGGER");
    const summonedDef = makeDef("TEST-PRIVATE-SUMMONED", "spirit");
    const definitions = [triggerDef, summonedDef];
    const lookup = makeLookup(definitions);
    const handSource = createCardInstance(triggerDef, {
      instanceId: "bob-hand-trigger",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const summonedCard = createCardInstance(summonedDef, {
      instanceId: "bob-private-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main" as const,
      cardInstances: [handSource, summonedCard],
    };
    const event = {
      eventKind: "summon" as const,
      actingPlayerId: "bob",
      source: "action_resolution" as const,
      chainId: "chain:private-summon",
      attackId: null,
      relatedPlayerId: "bob",
      relatedInstanceId: "bob-private-spirit",
      amount: null,
      cause: "self_effect" as const,
      fromZone: "trash" as const,
    };
    const options = {
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
    };

    const first = queuePendingReactionsFromTriggerEvents(
      state,
      [event],
      undefined,
      options
    );
    const second = queuePendingReactionsFromTriggerEvents(
      first,
      [event],
      undefined,
      options
    );

    expect(first.pendingTriggeredEffects).toHaveLength(0);
    expect(first.pendingBurstChecks).toHaveLength(0);
    expect(first.pendingPrivateDeclarations).toHaveLength(1);
    expect(second.pendingPrivateDeclarations).toHaveLength(1);
    expect(second.pendingPrivateDeclarations[0]).toMatchObject({
      ownerPlayerId: "bob",
      sourceInstanceId: "bob-hand-trigger",
      eventKind: "summon",
      chainId: "chain:private-summon",
      relatedInstanceId: "bob-private-spirit",
    });
  });

  it("externalSimultaneousGroupId を渡すと両 pending に同 ID が付与される", () => {
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [],
    });

    const events = [
      {
        eventKind: "destroy" as const,
        actingPlayerId: "alice",
        source: "action_resolution" as const,
        chainId: "test:trigger-system:4962",
        attackId: null,
        relatedPlayerId: "bob",
        relatedInstanceId: "s1",
        amount: null,
      },
    ];

    const next = queuePendingReactionsRawForTesting(
      baseState,
      events,
      "external-group:abc"
    );

    expect(next.pendingTriggeredEffects[0]?.simultaneousGroupId).toBe(
      "external-group:abc"
    );
    expect(next.pendingBurstChecks[0]?.simultaneousGroupId).toBe(
      "external-group:abc"
    );
  });
});

// ---------------------------------------------------------------------------
// 回帰: triggered effect の applicability チェック
//
// 「Lv2 以上のときのみ反応する game_event:summon トリガ」を持つネクサスが
// Lv1 時に candidate として拾われ、本来空であるべき pending が queue に
// 積まれる事象（BSTH01-R21 紅魔館 Lv1 で 8 コスト夜族赤スピリット召喚等）
// の再発防止。
// ---------------------------------------------------------------------------

describe("getAvailableTriggeredEffectSourceChoices - applicability フィルタ", () => {
  // 「自分の召喚」に反応するネクサス。Lv2 以上で発動。
  const responderNexus: CardDefinition = {
    cardNo: "TEST-NEXUS",
    name: "Test Responder Nexus",
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
        steps: [
          {
            action: {
              kind: "life_fill",
              player: "self",
              targetValue: 5,
            },
          },
        ],
        textRef: [0],
      },
    ],
  };

  // 召喚されるスピリット (responder の trigger filter は無いので何でもよい)。
  const summonedSpirit: CardDefinition = {
    cardNo: "TEST-SPIRIT",
    name: "Test Summoned Spirit",
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

  const allDefs = [responderNexus, summonedSpirit];
  const getDefById = (id: string): CardDefinition | undefined =>
    allDefs.find((d) => d.cardNo === id);
  const lookup = buildTriggeredEffectLookup(allDefs);

  function buildState(nexusCoreCount: 0 | 1): GameState {
    const nexus = createCardInstance(responderNexus, {
      instanceId: "nexus-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: nexusCoreCount,
    });
    const spirit = createCardInstance(summonedSpirit, {
      instanceId: "spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    return createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [nexus, spirit],
    });
  }

  function buildPending(): PendingTriggeredEffect {
    return {
      pendingId: "test-pending",
      actingPlayerId: "alice",
      eventKind: "summon",
      event: {
        family: "enter_field",
        actionKind: "summon",
        validationMode: "require_related_instance_on_field",
      },
      source: "action_resolution",
      chainId: "test:trigger-system:5076",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: "spirit-1",
      amount: null,
      step: "main",
      window: "none",
      resolvedSourceInstanceIds: [],
    };
  }

  it("Lv1 (applicability.level.min=2 不成立) のネクサスは候補に含まれない", () => {
    const state = buildState(0); // 0 cores → Lv1
    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: buildPending(),
      getCardDefinitionById: getDefById,
      getRegisteredTriggeredEffectActions: lookup,
    });
    expect(choices).toHaveLength(0);
  });

  it("Lv2 (applicability.level.min=2 成立) のネクサスは候補に含まれる", () => {
    const state = buildState(1); // 1 core → Lv2
    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: buildPending(),
      getCardDefinitionById: getDefById,
      getRegisteredTriggeredEffectActions: lookup,
    });
    expect(choices).toHaveLength(1);
    expect(choices[0]?.sourceCard.instanceId).toBe("nexus-1");
  });

  // GUI 表示用: buildResolutionItems が relatedInstanceId (= 召喚されたカード) ではなく
  // 実際のトリガ保持カード (= ネクサス) を sources[0] として返すこと。
  // これにより EffectQueueOverlay が正しい画像 (ネクサス) を表示する。
  it("buildResolutionItems: 未確定 pending は applicability スキャン結果 (実トリガ保持カード) を sources にする", async () => {
    const state = {
      ...buildState(1), // R21 相当 Lv2
      pendingTriggeredEffects: [buildPending()],
    } as GameState;
    const { buildResolutionItems } =
      await import("../src/effect/resolution-items");
    const items = buildResolutionItems({
      state,
      getCardDefinitionById: getDefById,
      getRegisteredTriggeredEffectActions: lookup,
    });
    expect(items).toHaveLength(1);
    // sources[0] は relatedInstanceId="spirit-1" ではなく、トリガ保持カード "nexus-1"
    expect(items[0]?.sources[0]?.instanceId).toBe("nexus-1");
    expect(items[0]?.sources[0]?.definitionId).toBe("TEST-NEXUS");
  });
});

describe("pendingTriggeredEffects stale legality pruning", () => {
  const frontNo = "TEST-STALE-QUEUE-C(A)";
  const backNo = "TEST-STALE-QUEUE-C(B)";
  const summonedNo = "TEST-STALE-QUEUE-A";

  const backDefinition: CardDefinition = {
    ...makeDef(backNo, "nexus"),
    name: "Test Queue C Back",
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  };
  const frontDefinition: CardDefinition = {
    ...makeDef(frontNo, "nexus"),
    name: "Test Queue C Front",
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    isDoubleSided: true,
    backFace: {
      cardNo: backNo,
      name: backDefinition.name,
      printedCategory: backDefinition.printedCategory,
      colors: backDefinition.colors,
      cost: backDefinition.cost,
      reductionSymbols: backDefinition.reductionSymbols,
      levelDefs: backDefinition.levelDefs,
      symbolColors: backDefinition.symbolColors,
      textLines: backDefinition.textLines,
      keywordTags: backDefinition.keywordTags,
    },
    effects: [
      {
        timing: { kind: "game_event", player: "self", event: "summon" },
        executionMode: "optional",
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
        textRef: [0],
      },
    ],
  };
  const summonedDefinition: CardDefinition = makeDef(summonedNo, "spirit");
  const definitions = [frontDefinition, backDefinition, summonedDefinition];
  const getDefById = makeLookup(definitions);
  const triggeredLookup = buildTriggeredEffectLookup(definitions);

  function buildSummonPending(pendingId: string): PendingTriggeredEffect {
    return {
      pendingId,
      actingPlayerId: "alice",
      eventKind: "summon",
      event: {
        family: "enter_field",
        actionKind: "summon",
        validationMode: "require_related_instance_on_field",
      },
      source: "action_resolution",
      chainId: `chain:${pendingId}`,
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: "summoned-a",
      amount: null,
      step: "main",
      window: "none",
      resolvedSourceInstanceIds: [],
    };
  }

  it("effect resolution prunes an older pending whose A-face source effect disappeared after rebirth", () => {
    const responder = createCardInstance(frontDefinition, {
      instanceId: "nexus-c",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 0,
    });
    const summoned = createCardInstance(summonedDefinition, {
      instanceId: "summoned-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const oldSummonPending = buildSummonPending("old-summon");
    const resolvingPending = buildSummonPending("resolve-flip");
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [responder, summoned],
      }),
      step: "main",
      pendingTriggeredEffects: [oldSummonPending, resolvingPending],
    } as GameState;

    expect(
      getAvailableTriggeredEffectSourceChoices({
        state,
        pendingEffect: oldSummonPending,
        getCardDefinitionById: getDefById,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }).map((choice) => choice.sourceCard.instanceId)
    ).toEqual(["nexus-c"]);

    const result = useResolvePendingTriggeredEffectAsAction({
      state,
      actingPlayerId: "alice",
      pendingId: resolvingPending.pendingId,
      resolveEffect: (currentState) => ({
        ...currentState,
        cardInstances: currentState.cardInstances.map((card) =>
          card.instanceId === "nexus-c"
            ? { ...card, definitionId: backNo }
            : card
        ),
      }),
      getCardDefinitionById: getDefById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });

    expect(
      result.state.pendingTriggeredEffects.map((p) => p.pendingId)
    ).not.toContain(oldSummonPending.pendingId);
    expect(result.state.log).toContain(
      `trigger:pruned-illegal:${oldSummonPending.pendingId}:summon`
    );
  });
});

describe("ENGINE-phase-whose-either-source-controller-actingplayerid: pendingTriggeredEffect.actingPlayerId は source controller に追従", () => {
  // 『お互いのメインステップ終了時』(phase whose:"either" subPhase:"end") に反応する
  // カード。色違いの 2 定義を用意して sourceColors 誤参照 (resolvedSourceInstanceIds 流用) の
  // silent bug を炙る (Lens 3 反証防止)。
  function makeEitherEndResponder(
    cardNo: string,
    color: "red" | "blue"
  ): CardDefinition {
    return {
      cardNo,
      name: `Test Either End Responder ${color}`,
      printedCategory: "spirit",
      colors: [color],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: [color],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: {
            kind: "phase",
            step: "main",
            whose: "either",
            subPhase: "end",
          },
          executionMode: "optional",
          steps: [
            {
              action: { kind: "count_increase", player: "self", amount: 1 },
            },
          ],
          textRef: [0],
        },
      ],
    };
  }
  // whose:"opponent" 経路の回帰用。
  const opponentResponder: CardDefinition = {
    cardNo: "TEST-WHOSE-OPPONENT-RESPONDER",
    name: "Test Opponent End Responder",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "phase",
          step: "main",
          whose: "opponent",
          subPhase: "end",
        },
        executionMode: "optional",
        steps: [
          {
            action: { kind: "count_increase", player: "self", amount: 1 },
          },
        ],
        textRef: [0],
      },
    ],
  };
  const responderRed = makeEitherEndResponder(
    "TEST-WHOSE-EITHER-RESPONDER-RED",
    "red"
  );
  const responderBlue = makeEitherEndResponder(
    "TEST-WHOSE-EITHER-RESPONDER-BLUE",
    "blue"
  );
  const allDefs = [responderRed, responderBlue, opponentResponder];
  const getDefById = (id: string): CardDefinition | undefined =>
    allDefs.find((d) => d.cardNo === id);
  const triggeredLookup = buildTriggeredEffectLookup(allDefs);
  const burstLookup = buildBurstEffectLookup(allDefs);

  // PHASE_STEP_TO_TRIGGER["main"] = "start_step" (subPhase:"end" は eventMatcher 側で絞る)。
  // 実プロダクションでは turn-system が step!=="end" のとき eventKind:"start_step" で発火する。
  function phaseEndEvent(actingPlayerId: "alice" | "bob") {
    return {
      eventKind: "start_step" as const,
      actingPlayerId,
      source: "step_transition" as const,
      chainId: "test:trigger-system:5359",
      attackId: null,
      relatedPlayerId: actingPlayerId,
      relatedInstanceId: null,
      amount: null,
      step: "main" as const,
      subPhase: "end" as const,
    };
  }

  it("alice 所有 + alice メインステップ終了 (whose=either): actingPlayerId は controller (alice)", () => {
    const card = createCardInstance(responderRed, {
      instanceId: "responder-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [card],
    });
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [phaseEndEvent("alice")],
      undefined,
      {
        getCardDefinitionById: getDefById,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: burstLookup,
      }
    );
    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    // alice 起点 = alice = controller。従来通り。
    expect(queued.pendingTriggeredEffects[0]!.actingPlayerId).toBe("alice");
  });

  it("alice 所有 + bob メインステップ終了 (whose=either): actingPlayerId は event acting (bob) ではなく controller (alice)", () => {
    const card = createCardInstance(responderRed, {
      instanceId: "responder-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [card],
    });
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [phaseEndEvent("bob")],
      undefined,
      {
        getCardDefinitionById: getDefById,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: burstLookup,
      }
    );
    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    // 修正前は pendingEffect.actingPlayerId = event.actingPlayerId ("bob") となり
    // resolvePlayerRef("self") が "bob" を返して self/opponent が反転していた。
    // 修正後は source の controllerPlayerId ("alice") に追従する。
    expect(queued.pendingTriggeredEffects[0]!.actingPlayerId).toBe("alice");
  });

  it("alice 所有 + alice メイン終了 (whose=opponent): 源 controller (alice) は『自分のメイン終了』には反応しない", () => {
    const card = createCardInstance(opponentResponder, {
      instanceId: "opp-responder-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [card],
    });
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      // 源 alice + 源視点で『自分のメイン終了』 → whose:"opponent" filter で reject。
      [phaseEndEvent("alice")],
      undefined,
      {
        getCardDefinitionById: getDefById,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: burstLookup,
      }
    );
    expect(queued.pendingTriggeredEffects).toHaveLength(0);
  });

  it("alice 所有 + bob メイン終了 (whose=opponent): actingPlayerId は controller (alice) に追従し event acting (bob) と一致しない", () => {
    const card = createCardInstance(opponentResponder, {
      instanceId: "opp-responder-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [card],
    });
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [phaseEndEvent("bob")],
      undefined,
      {
        getCardDefinitionById: getDefById,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: burstLookup,
      }
    );
    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    expect(queued.pendingTriggeredEffects[0]!.actingPlayerId).toBe("alice");
  });

  it("end-to-end: bob メイン終了 (whose=either) で resolve すると count_increase は controller (alice) の count に入る", () => {
    // 真の bug 表出: 修正前は resolvePlayerRef("self") が event.actingPlayerId="bob" を返し、
    // count_increase が bob の count に入っていた (self/opponent 反転)。
    // 修正後は alice (source controller) の count に入る。
    const card = createCardInstance(responderRed, {
      instanceId: "responder-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [card],
    });
    // step:"main" / activePlayerId="bob" (bob のメインステップ進行中)
    const state: GameState = {
      ...baseState,
      activePlayerId: "bob",
      step: "main",
    };
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [phaseEndEvent("bob")],
      undefined,
      {
        getCardDefinitionById: getDefById,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: burstLookup,
      }
    );
    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    const lookupOpts = {
      getCardDefinitionById: getDefById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: burstLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getHandWrittenEffectResolver: () => undefined,
    };
    // resolve action は controller alice 向けに発行される (nextActingPlayerId=alice)
    const resolveActions = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).filter((a) => a.kind === "resolve_pending_triggered_effect");
    expect(resolveActions.length).toBeGreaterThanOrEqual(1);
    const resolveAction = resolveActions.find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" && a.skipOnly !== true
    )!;
    expect(resolveAction).toBeDefined();
    if (resolveAction.kind !== "resolve_pending_triggered_effect")
      throw new Error("unreachable");
    // action.actingPlayerId は controller (alice) に追従する。
    expect(resolveAction.actingPlayerId).toBe("alice");
    let next = applyLegalAction({
      state: queued,
      action: resolveAction,
      ...lookupOpts,
    }).state;
    // stack window を pass_stack で cascade する。
    let safety = 30;
    while (safety-- > 0) {
      const actions = (["alice", "bob"] as const).flatMap((pid) =>
        getLegalActions({
          state: next,
          actingPlayerId: pid,
          ...lookupOpts,
        }).filter(
          (a) =>
            a.kind === "pass_stack" ||
            (a.kind === "resolve_pending_triggered_effect" &&
              a.skipOnly === true)
        )
      );
      if (actions.length === 0) break;
      next = applyLegalAction({
        state: next,
        action: actions[0]!,
        ...lookupOpts,
      }).state;
    }
    const aliceAfter = next.players.find((p) => p.id === "alice")!;
    const bobAfter = next.players.find((p) => p.id === "bob")!;
    // count_increase player:"self" → controller alice の count が +1。
    // 修正前は bob 側に +1 入っていた silent regression を end-to-end で塞ぐ。
    expect(aliceAfter.countValue).toBe(1);
    expect(bobAfter.countValue).toBe(0);
  });

  it("両プレイヤー所有 (異 definition) + alice メイン終了 (whose=either): 2 fork に分裂し sourceColors は流用せず各 fork が自 controller のみ候補化", () => {
    // 別 definition で源色を分けて、resolvedSourceInstanceIds 流用による誤色 attribution
    // (alice fork が bob 側の blue を sourceColors として参照する silent bug) を炙る。
    const aliceCard = createCardInstance(responderRed, {
      instanceId: "responder-alice-red",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const bobCard = createCardInstance(responderBlue, {
      instanceId: "responder-bob-blue",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [aliceCard, bobCard],
    });
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [phaseEndEvent("alice")],
      undefined,
      {
        getCardDefinitionById: getDefById,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: burstLookup,
      }
    );
    // 2 つの pending: alice fork と bob fork。
    expect(queued.pendingTriggeredEffects).toHaveLength(2);
    const byController = new Map(
      queued.pendingTriggeredEffects.map(
        (pe) => [pe.actingPlayerId, pe] as const
      )
    );
    expect(byController.get("alice")).toBeDefined();
    expect(byController.get("bob")).toBeDefined();
    // 排他は resolvedSourceRegistrationKeys (純 exclusion list) で行い、
    // resolvedSourceInstanceIds (sourceColors 根拠) を汚さない。
    expect(byController.get("alice")!.resolvedSourceInstanceIds).not.toContain(
      "responder-bob-blue"
    );
    expect(byController.get("bob")!.resolvedSourceInstanceIds).not.toContain(
      "responder-alice-red"
    );
    expect(byController.get("alice")!.resolvedSourceRegistrationKeys).toContain(
      "responder-bob-blue"
    );
    expect(byController.get("bob")!.resolvedSourceRegistrationKeys).toContain(
      "responder-alice-red"
    );
    // pendingId は controller suffix で区別。
    expect(byController.get("alice")!.pendingId).not.toBe(
      byController.get("bob")!.pendingId
    );
    // 各 fork で getAvailableTriggeredEffectSourceChoices が自 controller のカードのみ候補化する。
    const aliceChoices = getAvailableTriggeredEffectSourceChoices({
      state: {
        ...state,
        pendingTriggeredEffects: [byController.get("alice")!],
      },
      pendingEffect: byController.get("alice")!,
      getCardDefinitionById: getDefById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    expect(aliceChoices.map((c) => c.sourceCard.instanceId)).toEqual([
      "responder-alice-red",
    ]);
    const bobChoices = getAvailableTriggeredEffectSourceChoices({
      state: { ...state, pendingTriggeredEffects: [byController.get("bob")!] },
      pendingEffect: byController.get("bob")!,
      getCardDefinitionById: getDefById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    expect(bobChoices.map((c) => c.sourceCard.instanceId)).toEqual([
      "responder-bob-blue",
    ]);
  });
});
