import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  createGameSnapshot,
  executeEffect,
  getLegalActions,
  restoreSnapshot,
  type CardDefinition,
  type GameState,
  type LegalAction,
  type SupplementalTriggerEvent,
  type TriggeredMechanic,
} from "../src";
import type { Action, Effect } from "../src/dsl-types";
import { moveNormalCores } from "../src/core/core-system";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { captureTriggerObservation } from "../src/effect/trigger-observation-sources";
import {
  resolveDeferredMagicStack,
  useMagicCardInFlashContextAsAction,
} from "../src/mechanics/magic-system";

const real = (no: string) => ALL_CARDS.find((card) => card.cardNo === no)!;
const spirit: CardDefinition = {
  cardNo: "TEST-NATIVE-PRIORITY-SPIRIT",
  name: "順位比較",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  symbolColors: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  textLines: [],
  keywordTags: [],
};
const oracle: CardDefinition = {
  ...real("BSLH01-X01"),
  cardNo: "TEST-NATIVE-PRIORITY-ORACLE",
  effects: [],
  grandwalkerData: {
    ...real("BSLH01-X01").grandwalkerData!,
    oracleTriggerKinds: ["summon"],
    oracleConditions: [{ categories: ["spirit"] }],
  },
};
const printedStone = real("BSTH06-転醒X01(A)");
const { postRebirth: _postRebirth, ...stoneData } =
  printedStone.grandstoneData!;
const stone: CardDefinition = {
  ...printedStone,
  cardNo: "TEST-NATIVE-PRIORITY-STONE-A",
  effects: [],
  grandstoneData: {
    ...stoneData,
    unsealConditions: [
      { events: ["summon"], cardFilter: { categories: ["spirit"] } },
    ],
  },
  backFace: {
    ...printedStone.backFace!,
    cardNo: "TEST-NATIVE-PRIORITY-STONE-B",
    effects: [],
  },
};
function effect(
  event: "place" | "summon" | "effect_activated",
  action: Action
): Effect {
  return {
    timing: {
      kind: "game_event",
      event,
      player: "self",
      ...(event === "effect_activated"
        ? { triggerFilter: { categories: ["magic"] } }
        : {}),
    },
    steps: [{ action }],
  };
}
function make(
  def: CardDefinition,
  id: string,
  zone: "field" | "hand" | "deck",
  cores = 1,
  owner = "alice"
) {
  return createCardInstance(def, {
    instanceId: id,
    ownerPlayerId: owner,
    zone,
    normalCoreCount: zone === "field" ? cores : 0,
  });
}
function setup(
  definitions: CardDefinition[],
  cards: ReturnType<typeof make>[],
  voidCores = 20,
  count = 0
) {
  const defs = definitions.flatMap((def) =>
    def.backFace ? [def, def.backFace] : [def]
  );
  const deps = {
    getCardDefinitionById: (id: string) =>
      defs.find((def) => def.cardNo === id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
    getRegisteredBurstActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
  };
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: cards,
      playerOverrides: [
        {
          voidNormalCoreCount: voidCores,
          reserveNormalCoreCount: 10,
          countValue: count,
        },
        {},
      ],
    }),
    step: "main",
  };
  return { state, deps };
}
type Deps = ReturnType<typeof setup>["deps"];
function actions(state: GameState, deps: Deps) {
  return ["alice", "bob"].flatMap((actingPlayerId) =>
    getLegalActions({ state, actingPlayerId, ...deps })
  );
}
function act(
  state: GameState,
  deps: Deps,
  predicate: (action: LegalAction) => boolean
) {
  const choices = actions(state, deps);
  const action = choices.find(predicate);
  expect(
    action,
    JSON.stringify({ choices, log: state.log.slice(-8) })
  ).toBeDefined();
  return applyLegalAction({ state, action: action!, ...deps }).state;
}
function resolutionAction(action: LegalAction) {
  return (
    action.kind === "resolve_pending_triggered_effect" ||
    action.kind === "select_pending_to_resolve"
  );
}
function resolve(
  state: GameState,
  deps: Deps,
  source: string,
  mechanic?: TriggeredMechanic["kind"]
) {
  const native = mechanic
    ? state.pendingTriggeredEffects.find(
        (p) => p.relatedInstanceId === source && p.mechanic?.kind === mechanic
      )
    : undefined;
  const matches = (a: LegalAction) =>
    resolutionAction(a) &&
    (native
      ? a.pendingId === native.pendingId
      : a.sourceInstanceId === source && a.registrationIndex !== undefined);
  const first = actions(state, deps).find(matches);
  state = act(state, deps, matches);
  if (
    first?.kind === "select_pending_to_resolve" &&
    !state.stackWindow &&
    state.pendingTriggeredEffects.some(
      (p) => p.pendingId === first.pendingId && p.selectedByTurnPlayer
    )
  ) {
    state = act(
      state,
      deps,
      (a) => a.kind === "resolve_pending_triggered_effect" && matches(a)
    );
  }
  for (let i = 0; state.stackWindow && i < 16; i++)
    state = act(state, deps, (a) => a.kind === "pass_stack");
  expect(state.stackWindow).toBeNull();
  return state;
}
function native(
  state: GameState,
  kind: TriggeredMechanic["kind"],
  source = "source"
) {
  return state.pendingTriggeredEffects.find(
    (p) => p.mechanic?.kind === kind && p.relatedInstanceId === source
  );
}
function canChoose(
  state: GameState,
  deps: Deps,
  source: string,
  kind?: TriggeredMechanic["kind"]
) {
  const pending = kind ? native(state, kind, source) : undefined;
  return actions(state, deps).some(
    (a) =>
      resolutionAction(a) &&
      (kind
        ? a.pendingId === pending?.pendingId
        : a.sourceInstanceId === source)
  );
}
function queue(
  state: GameState,
  deps: Deps,
  kind: "place" | "summon",
  beforeState = state
) {
  const event: SupplementalTriggerEvent = {
    eventKind: kind,
    source: "action_resolution",
    chainId: "original-occurrence",
    attackId: null,
    actingPlayerId: "alice",
    relatedPlayerId: "alice",
    relatedInstanceId: kind === "place" ? "source" : "subject",
    amount: null,
    observationSnapshot: captureTriggerObservation(beforeState),
  };
  return collectAndQueueTriggerReactions({
    beforeState,
    afterState: state,
    source: "action_resolution",
    chainId: event.chainId,
    supplementalEvents: [event],
    ...deps,
  });
}

describe("native後成立の派生優先と処理資源の境界", () => {
  it.each([false, true])(
    "配置時の観測を親本文のドローと保存再開まで保持する (pause=%s)",
    (pause) => {
      const entryEffect: Effect = {
        timing: { kind: "card_event", event: "place" },
        condition: [{ kind: "hand_count", player: "self", min: 1 }],
        executionMode: "optional",
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      };
      const body: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          { action: { kind: "place" } },
          ...(pause
            ? ([
                {
                  action: { kind: "noop" },
                  choice: [
                    {
                      action: {
                        kind: "count_increase",
                        player: "self",
                        amount: 2,
                      },
                    },
                  ],
                },
              ] satisfies Effect["steps"])
            : []),
          { action: { kind: "draw", count: 1 } },
        ],
      };
      const nexus: CardDefinition = {
        ...spirit,
        cardNo: "TEST-PLACEMENT-CONDITION",
        printedCategory: "nexus",
        levelDefs: [{ level: 1, requiredCores: 0 }],
        effects: [entryEffect, body],
      };
      const f = setup(
        [nexus, spirit],
        [make(nexus, "nexus", "hand"), make(spirit, "drawn", "deck")]
      );
      const before = {
        ...f.state,
        players: f.state.players.map((player) =>
          player.id === "alice"
            ? { ...player, handCount: 1, deckCount: 1 }
            : player
        ),
      };
      const chainId = "place-and-refill";
      let state = executeEffect({
        state: before,
        effect: body,
        sourceInstanceId: "nexus",
        actingPlayerId: "alice",
        chainId,
        effectIndex: 1,
        promptUnresolvedChoice: pause,
        summonEnterFieldCorePlacements: [],
        ...f.deps,
      });
      if (pause) {
        expect(state.pendingStepChoice).not.toBeNull();
        expect(state.players[0]!.handCount).toBe(0);
        expect(canChoose(state, f.deps, "nexus")).toBe(false);
        state = restoreSnapshot(
          JSON.parse(JSON.stringify(createGameSnapshot(state))),
          f.deps.getCardDefinitionById,
          f.deps
        ).state;
        state = act(
          state,
          f.deps,
          (action) =>
            action.kind === "resolve_pending_step_choice" &&
            action.choiceIndex === 0
        );
      } else {
        state = collectAndQueueTriggerReactions({
          beforeState: before,
          afterState: state,
          source: "action_resolution",
          chainId,
          ...f.deps,
        });
      }
      expect(state.players[0]!.handCount).toBe(1);
      expect(canChoose(state, f.deps, "nexus")).toBe(true);
      state = resolve(state, f.deps, "nexus");
      expect(state.players[0]!.countValue).toBe(1);
      expect(canChoose(state, f.deps, "nexus")).toBe(false);
    }
  );

  it.each([false, true])(
    "配置時神託は保存再開後に同じ本文でデッキを補充しても発揮できる (initiallyEligible=%s)",
    (initiallyEligible) => {
      const body: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          { action: { kind: "place" } },
          ...(initiallyEligible
            ? ([
                { action: { kind: "draw", count: 1 } },
              ] satisfies Effect["steps"])
            : []),
          {
            action: { kind: "noop" },
            choice: [
              { action: { kind: "count_increase", player: "self", amount: 2 } },
            ],
          },
          {
            action: {
              kind: "move_card",
              from: { zone: "hand", player: "self" },
              to: { zone: "deck", player: "self" },
              count: 1,
            },
          },
        ],
      };
      const reaction: Effect = {
        timing: { kind: "card_event", event: "place" },
        executionMode: "optional",
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      };
      const nexus = { ...oracle, effects: [body, reaction] };
      const { state: initial, deps } = setup(
        [nexus, spirit],
        [
          make(nexus, "source", "hand"),
          make(spirit, "restock", initiallyEligible ? "deck" : "hand"),
        ]
      );
      const before = {
        ...initial,
        players: initial.players.map((player) =>
          player.id === "alice"
            ? {
                ...player,
                handCount: initiallyEligible ? 1 : 2,
                deckCount: initiallyEligible ? 1 : 0,
              }
            : player
        ),
      };
      const paused = executeEffect({
        state: before,
        effect: body,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        chainId: "place-oracle-and-restock",
        effectIndex: 0,
        promptUnresolvedChoice: true,
        summonEnterFieldCorePlacements: [],
        ...deps,
      });
      expect(paused.pendingStepChoice).not.toBeNull();
      expect(paused.players[0]!.deckCount).toBe(0);
      const group = paused.pendingTriggeredEffects.find(
        (pending) => pending.eventKind === "place" && !pending.mechanic
      )?.simultaneousGroupId;
      expect(group).toBeDefined();
      expect(native(paused, "placement_oracle")?.simultaneousGroupId).toBe(
        group
      );
      const restored = restoreSnapshot(
        JSON.parse(JSON.stringify(createGameSnapshot(paused))),
        deps.getCardDefinitionById,
        deps
      ).state;
      expect(native(restored, "placement_oracle")?.dormantMechanic).toBe(true);
      for (const initial of [paused, restored]) {
        let state = act(
          initial,
          deps,
          (action) =>
            action.kind === "resolve_pending_step_choice" &&
            action.choiceIndex === 0
        );
        expect(
          state.cardInstances.find((card) => card.instanceId === "restock")
            ?.zone
        ).toBe("deck");
        expect(canChoose(state, deps, "source", "placement_oracle")).toBe(true);
        state = resolve(state, deps, "source", "placement_oracle");
        expect(
          state.cardInstances.find((card) => card.instanceId === "restock")
            ?.zone
        ).toBe("trash");
      }
    }
  );

  it.each([false, true])(
    "本文の複数の選択で条件が揺れても、配置時の観測を本文末まで保持する (initiallyEligible=%s)",
    (initiallyEligible) => {
      const entryEffect: Effect = {
        timing: { kind: "card_event", event: "place" },
        condition: [{ kind: "hand_count", player: "self", min: 1 }],
        executionMode: "optional",
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      };
      const chooseCores: Action = {
        kind: "core_move",
        from: { kind: "void", player: "self" },
        to: { kind: "reserve", player: "self" },
        amount: { min: 0, max: 1 },
      };
      const body: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          { action: { kind: "place" } },
          ...(!initiallyEligible
            ? ([
                { action: { kind: "draw", count: 1 } },
              ] satisfies Effect["steps"])
            : []),
          { action: chooseCores },
          {
            action: { kind: "discard", player: "self", count: 1, unseen: true },
          },
          { action: chooseCores },
          { action: { kind: "draw", count: 1 } },
        ],
      };
      const nexus: CardDefinition = {
        ...spirit,
        cardNo: "TEST-PLACEMENT-INTERRUPTED",
        printedCategory: "nexus",
        levelDefs: [{ level: 1, requiredCores: 0 }],
        effects: [entryEffect, body],
      };
      const { state: initial, deps } = setup(
        [nexus, spirit],
        [
          make(nexus, "source", "hand"),
          make(spirit, "first", initiallyEligible ? "hand" : "deck"),
          make(spirit, "deck-second", "deck"),
        ]
      );
      const before = {
        ...initial,
        players: initial.players.map((player) =>
          player.id === "alice"
            ? {
                ...player,
                handCount: initiallyEligible ? 2 : 1,
                deckCount: initiallyEligible ? 1 : 2,
              }
            : player
        ),
      };
      let state = executeEffect({
        state: before,
        effect: body,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        chainId: "place-and-wait-twice",
        effectIndex: 1,
        promptUnresolvedChoice: true,
        summonEnterFieldCorePlacements: [],
        ...deps,
      });
      for (const handCount of [1, 0]) {
        expect(state.pendingCoreCountSelection).not.toBeNull();
        expect(state.players[0]!.handCount).toBe(handCount);
        const action = actions(state, deps).find(
          (a) => a.kind === "resolve_pending_core_count"
        );
        expect(action).toBeDefined();
        state = applyLegalAction({
          state,
          action: action!,
          coreCountSelection: 0,
          ...deps,
        }).state;
      }
      expect(state.pendingCoreCountSelection).toBeNull();
      expect(state.players[0]!.handCount).toBe(1);
      expect(canChoose(state, deps, "source")).toBe(true);
      state = resolve(state, deps, "source");
      expect(state.players[0]!.countValue).toBe(1);
      expect(canChoose(state, deps, "source")).toBe(false);
    }
  );

  it("配置で一時的に成立した条件を、同じ本文のドロー前に確定しない", () => {
    const response = effect("summon", {
      kind: "count_increase",
      player: "self",
      amount: 1,
    });
    const observer: CardDefinition = {
      ...spirit,
      cardNo: "TEST-HAND-CONDITION-OBSERVER",
      effects: [
        {
          ...response,
          condition: [{ kind: "hand_count", player: "self", max: 5 }],
        },
      ],
    };
    const peer: CardDefinition = {
      ...spirit,
      cardNo: "TEST-HAND-CONDITION-PEER",
      effects: [response],
    };
    const placement: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        { action: { kind: "place" } },
        { action: { kind: "draw", count: 1 } },
      ],
    };
    const nexus: CardDefinition = {
      ...spirit,
      cardNo: "TEST-HAND-CONDITION-NEXUS",
      printedCategory: "nexus",
      levelDefs: [{ level: 1, requiredCores: 0 }],
      effects: [placement],
    };
    const f = setup(
      [observer, peer, nexus, spirit],
      [
        make(observer, "observer", "field"),
        make(peer, "peer", "field"),
        make(spirit, "subject", "field"),
        make(nexus, "placement", "hand"),
        ...Array.from({ length: 5 }, (_, index) =>
          make(spirit, `hand-${index}`, "hand")
        ),
        make(spirit, "drawn", "deck"),
      ]
    );
    const initial = queue(
      {
        ...f.state,
        players: f.state.players.map((player) =>
          player.id === "alice"
            ? { ...player, handCount: 6, deckCount: 1 }
            : player
        ),
      },
      f.deps,
      "summon"
    );
    const observed = initial.pendingTriggeredEffects.find((pending) =>
      pending.dormantSourceRegistrationKeys?.includes("observer#0")
    );
    expect(observed).toBeDefined();
    const chainId = "placement-and-draw";
    const result = executeEffect({
      state: initial,
      effect: placement,
      sourceInstanceId: "placement",
      actingPlayerId: "alice",
      chainId,
      summonEnterFieldCorePlacements: [],
      ...f.deps,
    });
    expect(
      result.cardInstances.find((card) => card.instanceId === "placement")?.zone
    ).toBe("field");
    expect(
      result.cardInstances.find((card) => card.instanceId === "drawn")?.zone
    ).toBe("hand");
    expect(result.players[0]!.handCount).toBe(6);
    const finished = collectAndQueueTriggerReactions({
      beforeState: initial,
      afterState: result,
      source: "action_resolution",
      chainId,
      ...f.deps,
    });
    expect(
      finished.pendingTriggeredEffects.find(
        (pending) => pending.pendingId === observed?.pendingId
      )?.dormantSourceRegistrationKeys
    ).toContain("observer#0");
    expect(
      finished.pendingTriggeredEffects.every(
        (pending) => !pending.activationPriority
      )
    ).toBe(true);
  });

  it("同名不在が後成立した配置時神託は、元群のドローより先に宣言・解決する", () => {
    const source: CardDefinition = {
      ...oracle,
      effects: [
        {
          ...effect("place", { kind: "move_self", destination: "hand" }),
          timing: {
            kind: "game_event",
            event: "place",
            player: "self",
            excludeTriggerSelf: true,
          },
        },
      ],
    };
    const outer: CardDefinition = {
      ...spirit,
      cardNo: "TEST-OUTER-DRAW",
      effects: [effect("place", { kind: "draw", count: 1 })],
    };
    const f = setup(
      [source, outer, spirit],
      [
        make(source, "source", "field", 0),
        make(source, "enabler", "field", 0),
        make(outer, "outer", "field"),
        ...[0, 1, 2].map((i) => make(spirit, `deck-${i}`, "deck")),
      ]
    );
    let state = queue(f.state, f.deps, "place");
    const original = native(state, "placement_oracle")!;
    expect(original.dormantMechanicCondition).toBe(true);
    state = resolve(state, f.deps, "enabler");
    expect(
      native(state, "placement_oracle")?.simultaneousGroupId,
      JSON.stringify({
        pending: state.pendingTriggeredEffects,
        cardZones: state.cardInstances.map(({ instanceId, zone }) => [
          instanceId,
          zone,
        ]),
        log: state.log.slice(-25),
      })
    ).toBe(original.simultaneousGroupId);
    expect(native(state, "placement_oracle")?.activationPriority).toBeDefined();
    expect(canChoose(state, f.deps, "source", "placement_oracle")).toBe(true);
    expect(canChoose(state, f.deps, "outer")).toBe(false);
    state = resolve(state, f.deps, "source", "placement_oracle");
    expect(
      state.cardInstances.filter(
        (c) => c.instanceId.startsWith("deck-") && c.zone === "trash"
      )
    ).toHaveLength(3);
    expect(canChoose(state, f.deps, "outer")).toBe(true);
  });

  it("配置時神託のデッキだけが補充された場合、元群のドローと同列のまま", () => {
    const enabler: CardDefinition = {
      ...spirit,
      cardNo: "TEST-DECK-ENABLER",
      effects: [effect("place", { kind: "move_self", destination: "deck" })],
    };
    const outer: CardDefinition = {
      ...spirit,
      cardNo: "TEST-DECK-OUTER",
      effects: [effect("place", { kind: "draw", count: 1 })],
    };
    const f = setup(
      [oracle, enabler, outer],
      [
        make(oracle, "source", "field", 0),
        make(enabler, "enabler", "field"),
        make(outer, "outer", "field"),
      ]
    );
    let state = queue(f.state, f.deps, "place");
    expect(native(state, "placement_oracle")?.dormantMechanic).toBe(true);
    expect(
      native(state, "placement_oracle")?.dormantMechanicCondition
    ).not.toBe(true);
    state = resolve(state, f.deps, "enabler");
    expect(
      native(state, "placement_oracle")?.activationPriority
    ).toBeUndefined();
    expect(canChoose(state, f.deps, "source", "placement_oracle")).toBe(true);
    expect(canChoose(state, f.deps, "outer")).toBe(true);
    state = resolve(state, f.deps, "outer");
    expect(
      state.cardInstances.find((c) => c.instanceId === "enabler")?.zone
    ).toBe("hand");
    expect(native(state, "placement_oracle")).toBeUndefined();
  });

  it.each(["oracle", "unseal"] as const)(
    "%s のボイドだけの補充では、元群に対する優先を作らない",
    (kind) => {
      const source = kind === "oracle" ? oracle : stone;
      const enabler: CardDefinition = {
        ...spirit,
        cardNo: "TEST-VOID-ENABLER",
        effects: [
          effect("summon", {
            kind: "core_move",
            from: { kind: "reserve", player: "self" },
            to: { kind: "void", player: "self" },
            amount: 1,
          }),
        ],
      };
      const outer: CardDefinition = {
        ...spirit,
        cardNo: "TEST-VOID-OUTER",
        effects: [
          effect("summon", {
            kind: "count_increase",
            player: "self",
            amount: 1,
          }),
        ],
      };
      const f = setup(
        [source, spirit, enabler, outer],
        [
          make(source, "source", "field", 0),
          make(spirit, "subject", "field"),
          make(enabler, "enabler", "field"),
          make(outer, "outer", "field"),
        ],
        0
      );
      let state = queue(f.state, f.deps, "summon");
      state = resolve(state, f.deps, "enabler");
      expect(native(state, kind)?.activationPriority).toBeUndefined();
      expect(canChoose(state, f.deps, "source", kind)).toBe(true);
      expect(canChoose(state, f.deps, "outer")).toBe(true);
      state = resolve(state, f.deps, "source", kind);
      expect(
        state.cardInstances.find((c) => c.instanceId === "source")
          ?.normalCoreCount
      ).toBe(1);
      expect(state.players[0]?.voidNormalCoreCount).toBe(0);
    }
  );

  it("導域Lv2の後成立を元発揮群の外側効果より優先する", () => {
    const printed = real("BSTH10.5-X01");
    const source: CardDefinition = {
      ...printed,
      cardNo: "TEST-LATE-DOMAIN",
      grandwalkerData: { ...printed.grandwalkerData!, oracleTriggerKinds: [] },
      effects: [
        effect("effect_activated", {
          kind: "core_move",
          from: { kind: "void", player: "self" },
          to: { kind: "this_card" },
          amount: 1,
        }),
      ],
    };
    const outer: CardDefinition = {
      ...spirit,
      cardNo: "TEST-DOMAIN-OUTER",
      effects: [
        effect("effect_activated", {
          kind: "count_increase",
          player: "self",
          amount: 1,
        }),
      ],
    };
    const magic: CardDefinition = {
      ...spirit,
      cardNo: "TEST-PRIORITY-MAGIC",
      printedCategory: "magic",
      colors: ["blue"],
      levelDefs: [],
      keywordTags: ["stack_effect"],
      effects: [
        {
          timing: { kind: "activated", mode: "stack" },
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
        },
      ],
    };
    const f = setup(
      [source, outer, magic],
      [
        make(source, "source", "field", 2),
        make(outer, "outer", "field"),
        make(magic, "used", "hand"),
        ...[0, 1, 2, 3].map((i) =>
          make(magic, `opponent-${i}`, "deck", 0, "bob")
        ),
      ]
    );
    const declared = useMagicCardInFlashContextAsAction({
      state: f.state,
      actingPlayerId: "alice",
      magicInstanceId: "used",
      chosenTiming: "stack",
      paymentSources: [],
      ...f.deps,
    });
    let state = resolveDeferredMagicStack({
      state: declared.state,
      activeStack: declared.activeStack,
      ...f.deps,
    });
    expect(native(state, "magic_stack_domain")?.dormantMechanicCondition).toBe(
      true
    );
    state = resolve(state, f.deps, "source");
    expect(
      native(state, "magic_stack_domain")?.activationPriority
    ).toBeDefined();
    expect(canChoose(state, f.deps, "source", "magic_stack_domain")).toBe(true);
    expect(canChoose(state, f.deps, "outer")).toBe(false);
    state = resolve(state, f.deps, "source", "magic_stack_domain");
    expect(
      state.cardInstances.filter(
        (c) => c.ownerPlayerId === "bob" && c.zone === "trash"
      )
    ).toHaveLength(4);
    expect(canChoose(state, f.deps, "outer")).toBe(true);
  });

  it("石countの後成立を優先しても元事象の1転醒制限を維持し、新たなコア増加なら転醒できる", () => {
    const maximum = stone.grandstoneData!.rebirthMaxCount!;
    const threshold = stone.grandstoneData!.rebirthCoreThreshold!;
    const enabler: CardDefinition = {
      ...spirit,
      cardNo: "TEST-COUNT-ENABLER",
      effects: [
        effect("summon", { kind: "count_decrease", player: "self", amount: 2 }),
      ],
    };
    const outer: CardDefinition = {
      ...spirit,
      cardNo: "TEST-COUNT-OUTER",
      effects: [
        effect("summon", { kind: "count_increase", player: "self", amount: 1 }),
      ],
    };
    const noUnseal: CardDefinition = {
      ...stone,
      grandstoneData: { ...stone.grandstoneData!, unsealConditions: [] },
    };
    const f = setup(
      [noUnseal, spirit, enabler, outer],
      [
        make(noUnseal, "source", "field", threshold - 1),
        make(noUnseal, "second", "field", threshold - 1),
        make(spirit, "subject", "field"),
        make(enabler, "enabler", "field"),
        make(outer, "outer", "field"),
      ],
      20,
      maximum + 1
    );
    let moved = moveNormalCores(
      f.state,
      { kind: "void", playerId: "alice" },
      { kind: "card", instanceId: "source" },
      1
    );
    moved = moveNormalCores(
      moved,
      { kind: "void", playerId: "alice" },
      { kind: "card", instanceId: "second" },
      1
    );
    let state = queue(moved, f.deps, "summon", f.state);
    const originalGroup = native(state, "stone_rebirth")!.simultaneousGroupId;
    expect(native(state, "stone_rebirth", "second")!.simultaneousGroupId).toBe(
      originalGroup
    );
    state = resolve(state, f.deps, "enabler");
    expect(canChoose(state, f.deps, "outer")).toBe(false);
    expect(canChoose(state, f.deps, "source", "stone_rebirth")).toBe(true);
    expect(canChoose(state, f.deps, "second", "stone_rebirth")).toBe(true);
    expect(native(state, "stone_rebirth")!.simultaneousGroupId).toBe(
      originalGroup
    );
    state = resolve(state, f.deps, "source", "stone_rebirth");
    expect(
      state.cardInstances.find((c) => c.instanceId === "source")?.definitionId
    ).toBe(noUnseal.backFace!.cardNo);
    expect(state.players[0]?.countValue).toBe(maximum);
    expect(native(state, "stone_rebirth", "second")).toBeUndefined();
    expect(canChoose(state, f.deps, "second", "stone_rebirth")).toBe(false);
    // The first rebirth did not make this source exceed its count condition.
    const beforeNewCause = state;
    state = moveNormalCores(
      state,
      { kind: "void", playerId: "alice" },
      { kind: "card", instanceId: "second" },
      1
    );
    state = collectAndQueueTriggerReactions({
      beforeState: beforeNewCause,
      afterState: state,
      source: "action_resolution",
      chainId: "new-stone-core-event",
      ...f.deps,
    });
    expect(canChoose(state, f.deps, "second", "stone_rebirth")).toBe(true);
    state = resolve(state, f.deps, "second", "stone_rebirth");
    expect(
      state.cardInstances.find((c) => c.instanceId === "second")?.definitionId
    ).toBe(noUnseal.backFace!.cardNo);
  });
});
