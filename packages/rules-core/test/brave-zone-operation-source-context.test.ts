import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction, getLegalActions } from "../src/runtime";
import type { Action, Effect } from "../src/dsl-types";
import type {
  CardCategory,
  CardDefinition,
  ContinuousEffect,
  GameState,
} from "../src/model";

const spirit: CardDefinition = {
  cardNo: "TEST-ZONE-SOURCE-SPIRIT",
  name: "host",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  tribe: "",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};
const brave: CardDefinition = {
  ...spirit,
  cardNo: "TEST-ZONE-SOURCE-BRAVE",
  name: "brave",
  printedCategory: "brave",
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  combinedBoost: 1000,
  braveCondition: { categories: ["spirit"] },
};
const getDef = (id: string) =>
  id === brave.cardNo ? brave : id === spirit.cardNo ? spirit : undefined;
const legalOptions = {
  getCardDefinitionById: getDef,
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBurstActions: () => [],
};

function immunity(category: CardCategory, target = "target"): ContinuousEffect {
  return {
    effectId: `immune:${target}`,
    sourceInstanceId: "protection",
    sourceDefinitionId: spirit.cardNo,
    actingPlayerId: "bob",
    targetInstanceId: target,
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    immunitySourceScope: { categories: [category] },
  };
}
function setup(zone: "hand" | "deck", combined: boolean): GameState {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(brave, {
        instanceId: "brave",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: combined ? 0 : 1,
        attachedToInstanceId: combined ? "host" : null,
      }),
      createCardInstance(spirit, {
        instanceId: "host",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
        attachedChildrenIds: combined ? ["brave"] : [],
      }),
      createCardInstance(spirit, {
        instanceId: "protection",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(spirit, {
        instanceId: "target",
        ownerPlayerId: "bob",
        zone,
      }),
    ],
  });
}
const operations: {
  name: string;
  zone: "hand" | "deck";
  action: Action;
  moved?: "trash" | "hand";
  log?: string;
}[] = [
  {
    name: "discard hand",
    zone: "hand",
    action: { kind: "discard", player: "opponent", count: 1 },
    moved: "trash",
  },
  {
    name: "discard deck",
    zone: "deck",
    action: { kind: "discard", player: "opponent", fromZone: "deck", count: 1 },
    moved: "trash",
  },
  {
    name: "reveal hand",
    zone: "hand",
    action: { kind: "reveal_hand", player: "opponent", revealTo: "both" },
    log: "effect:reveal_hand:bob:revealTo=",
  },
  {
    name: "peek deck",
    zone: "deck",
    action: {
      kind: "peek_deck",
      player: "opponent",
      count: 1,
      revealTo: "self",
    },
    log: "effect:peek_deck:bob:revealTo=",
  },
  {
    name: "open deck",
    zone: "deck",
    action: {
      kind: "deck_reveal",
      player: "opponent",
      revealCount: 1,
      picks: [],
      remainder: "trash",
    },
    moved: "trash",
  },
  {
    name: "draw",
    zone: "deck",
    action: { kind: "draw", player: "opponent", count: 1 },
    moved: "hand",
  },
];
const cases = [
  {
    name: "own summon",
    event: "summon",
    combined: false,
    host: false,
    category: "spirit",
    allowed: true,
  },
  {
    name: "own attack",
    event: "attack",
    combined: false,
    host: false,
    category: "spirit",
    allowed: false,
  },
  {
    name: "own contract combine",
    event: "brave_combined",
    combined: true,
    host: false,
    category: "spirit",
    allowed: true,
  },
  {
    name: "host spirit immunity",
    event: "brave_combined",
    combined: true,
    host: true,
    category: "spirit",
    allowed: false,
  },
  {
    name: "host brave immunity",
    event: "brave_combined",
    combined: true,
    host: true,
    category: "brave",
    allowed: true,
  },
  {
    name: "own summon brave immunity",
    event: "summon",
    combined: false,
    host: false,
    category: "brave",
    allowed: false,
  },
] as const;

describe.each(operations)("Q378 zone gate: $name", (operation) => {
  it.each(cases)("$name", (scenario) => {
    const state = setup(operation.zone, scenario.combined);
    state.activeContinuousEffects = [immunity(scenario.category)];
    const effect: Effect = {
      timing: {
        kind: "card_event",
        event: ["summon", "attack", "brave_combined"],
      },
      steps: [{ action: operation.action }],
    };
    let after = executeEffect({
      state,
      effect,
      sourceInstanceId: scenario.host ? "host" : "brave",
      actingPlayerId: "alice",
      ...(scenario.host
        ? {
            effectSourceInstanceId: "brave",
            effectSourceDefinitionId: brave.cardNo,
          }
        : {}),
      effectIndex: 0,
      effectEventAction: scenario.event,
      chainId: `zone:${operation.name}:${scenario.name}`,
      ...legalOptions,
    });
    if (after.pendingDeckReveal) {
      const action = getLegalActions({
        state: after,
        actingPlayerId: "alice",
        ...legalOptions,
      }).find(
        (candidate) => candidate.kind === "resolve_pending_deck_reveal_pick"
      );
      expect(action).toBeDefined();
      after = applyLegalAction({
        state: after,
        action: action!,
        selectedDeckRevealCardIds: [],
        ...legalOptions,
      }).state;
    }
    if (operation.moved)
      expect(
        after.cardInstances.find((card) => card.instanceId === "target")!.zone
      ).toBe(scenario.allowed ? operation.moved : operation.zone);
    if (operation.log)
      expect(after.log.some((entry) => entry.startsWith(operation.log!))).toBe(
        scenario.allowed
      );
    expect(after.pendingZoneSelection).toBeNull();
    expect(after.pendingDeckReveal).toBeNull();
  });
});

it.each(["summon", "attack"] as const)(
  "discard selection preserves actual %s timing after save/restore and new immunity",
  (event) => {
    const state = setup("hand", false);
    state.cardInstances.push(
      createCardInstance(spirit, {
        instanceId: "other",
        ownerPlayerId: "bob",
        zone: "hand",
      })
    );
    state.players = state.players.map((player) =>
      player.id === "bob" ? { ...player, handCount: 2 } : player
    );
    const effect: Effect = {
      timing: { kind: "card_event", event: ["summon", "attack"] },
      steps: [{ action: { kind: "discard", player: "opponent", count: 1 } }],
    };
    const pending = executeEffect({
      state,
      effect,
      sourceInstanceId: "brave",
      actingPlayerId: "alice",
      effectIndex: 0,
      effectEventAction: event,
      chainId: `discard-pending:${event}`,
      ...legalOptions,
    });
    expect(pending.pendingZoneSelection?.candidateCardInstanceIds).toEqual([
      "target",
      "other",
    ]);
    const restored: GameState = JSON.parse(JSON.stringify(pending));
    restored.activeContinuousEffects = [immunity("spirit")];
    const action = getLegalActions({
      state: restored,
      actingPlayerId: "bob",
      ...legalOptions,
    }).find((candidate) => candidate.kind === "resolve_pending_zone_selection");
    expect(action).toBeDefined();
    const after = applyLegalAction({
      state: restored,
      action: action!,
      selectedZoneCardIds: ["target"],
      ...legalOptions,
    }).state;
    expect(
      after.cardInstances.find((card) => card.instanceId === "target")!.zone
    ).toBe(event === "summon" ? "trash" : "hand");
    expect(
      after.cardInstances.find((card) => card.instanceId === "other")!.zone
    ).toBe("hand");
    expect(after.pendingZoneSelection).toBeNull();
  }
);
