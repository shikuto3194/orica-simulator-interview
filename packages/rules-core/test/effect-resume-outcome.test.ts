import { expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "@orica/rules-core";
const responder = ALL_CARDS.find((c) => c.cardNo === "BSGE01-C13");
const effect = {
  timing: { kind: "activated", mode: "flash" },
  steps: [
    {
      id: "target",
      action: {
        kind: "exhaust",
        target: {
          kind: "filter",
          player: "opponent",
          filter: { category: ["nexus"] },
          count: 1,
        },
      },
    },
    {
      connector: "sequential",
      action: {
        kind: "core_move",
        from: { kind: "void", player: "self" },
        to: { kind: "life", player: "self" },
        amount: { source: { kind: "event_amount" } },
      },
    },
  ],
};
const source = {
  ...ALL_CARDS.find((c) => c.cardNo === "BSDB01-C05"),
  cardNo: "TEST-AMOUNT",
  effects: [effect],
};
function fixture(withResponse) {
  const defs = [source, responder];
  const lookups = {
    getCardDefinitionById: (id) => defs.find((c) => c.cardNo === id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(
      withResponse ? [responder] : []
    ),
    getRegisteredFieldCardEffectActions: () => [],
  };
  let state = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 4 }, {}],
      cardInstances: [
        createCardInstance(source, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        }),
        createCardInstance(responder, {
          instanceId: "responder",
          ownerPlayerId: "bob",
          zone: "field",
        }),
      ],
    }),
    step: "main",
    activePlayerId: "alice",
  };
  const base = state.players[0].lifeNormalCoreCount;
  state = executeEffect({
    state,
    effect,
    effectIndex: 0,
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    chainId: "audit:event-amount",
    eventAmount: 2,
    targetInstanceIds: ["responder"],
    targetSelectionResolved: true,
    ...lookups,
  });
  const paused = !!state.pendingTargetedDisclosureContinuation;
  if (withResponse) {
    if (!paused)
      throw Error("no disclosure pause " + JSON.stringify(state.log));
    for (
      let i = 0;
      i < 18 && state.pendingTargetedDisclosureContinuation;
      i++
    ) {
      const players = state.stackWindow
        ? [state.stackWindow.priorityPlayerId]
        : ["bob", "alice"];
      const actions = players.flatMap((actingPlayerId) =>
        getLegalActions({ state, actingPlayerId, ...lookups })
      );
      const action = actions.find(
        (a) =>
          [
            "pass_stack",
            "resolve_pending_burst_check",
            "select_pending_to_resolve",
            "resolve_pending_triggered_effect",
          ].includes(a.kind) ||
          (a.kind === "resolve_pending_step_optional_choice" &&
            a.choice === "execute")
      );
      expect(action, JSON.stringify(actions)).toBeDefined();
      state = applyLegalAction({
        state,
        action,
        skipOptionalEffect: action.kind === "resolve_pending_triggered_effect",
        ...lookups,
      }).state;
    }
    expect(state.pendingTargetedDisclosureContinuation).toBeFalsy();
  }
  return {
    paused,
    lifeDelta: state.players[0].lifeNormalCoreCount - base,
    state,
  };
}
it("target disclosure pause preserves the triggering numeric amount", () => {
  const direct = fixture(false);
  const paused = fixture(true);
  expect(direct.lifeDelta).toBe(2);
  expect(paused.lifeDelta, paused.state.log.slice(-30).join("\n")).toBe(2);
});

it("zone choice preserves the triggering amount across JSON and resume", () => {
  const move = effect.steps[1];
  const discard = {
    id: "discard",
    action: { kind: "discard", player: "self", count: 1 },
  };
  const discardEffect = { ...effect, steps: [discard, move] };
  const discardSource = {
    ...source,
    cardNo: "TEST-DISCARD-AMOUNT",
    effects: [discardEffect],
  };
  const baseCard = { ...source, cardNo: "TEST-HAND", effects: [] };
  const lookups = {
    getCardDefinitionById: (id) =>
      [discardSource, baseCard].find((card) => card.cardNo === id),
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
  };
  const initial = (n) => ({
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(discardSource, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        }),
        ...Array.from({ length: n }, (_, i) =>
          createCardInstance(baseCard, {
            instanceId: "hand-" + i,
            ownerPlayerId: "alice",
            zone: "hand",
          })
        ),
      ],
    }),
    step: "main",
    activePlayerId: "alice",
  });
  const run = (state) =>
    executeEffect({
      state,
      effect: discardEffect,
      effectIndex: 0,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      chainId: "audit:zone-amount",
      eventAmount: 2,
      ...lookups,
    });
  const direct = run(initial(1));
  expect(direct.pendingZoneSelection).toBeFalsy();
  expect(direct.players[0].lifeNormalCoreCount).toBe(7);
  expect(direct.cardInstances.find((c) => c.instanceId === "hand-0").zone).toBe(
    "trash"
  );
  const pending = run(initial(2));
  expect(pending.pendingZoneSelection?.continuation).toBeDefined();

  expect(pending.players[0].lifeNormalCoreCount).toBe(5);
  const saved = JSON.parse(JSON.stringify(pending));
  const action = getLegalActions({
    state: saved,
    actingPlayerId: "alice",
    ...lookups,
  }).find((a) => a.kind === "resolve_pending_zone_selection");
  expect(action).toBeDefined();
  const resumed = applyLegalAction({
    state: saved,
    action,
    selectedZoneCardIds: ["hand-0"],
    ...lookups,
  }).state;
  expect(resumed.pendingZoneSelection).toBeFalsy();
  expect(
    resumed.cardInstances.find((c) => c.instanceId === "hand-0").zone
  ).toBe("trash");
  expect(resumed.players[0].lifeNormalCoreCount).toBe(7);
});

it("core quantity choice mutates chosen core count and preserves the triggering amount", () => {
  const move = effect.steps[1];
  const choose = {
    id: "choose",
    action: {
      kind: "core_move",
      from: { kind: "life", player: "opponent" },
      to: { kind: "void", player: "opponent" },
      amount: { min: 0, max: 2 },
    },
  };
  const countEffect = { ...effect, steps: [choose, move] };
  const countSource = {
    ...source,
    cardNo: "TEST-CORE-AMOUNT",
    effects: [countEffect],
  };
  const lookups = {
    getCardDefinitionById: (id) =>
      id === countSource.cardNo ? countSource : undefined,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
  };
  const initial = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(countSource, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        }),
      ],
    }),
    step: "main",
    activePlayerId: "alice",
  };
  const run = (state, firstStep) =>
    executeEffect({
      state,
      effect: { ...countEffect, steps: [firstStep, move] },
      effectIndex: 0,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      chainId: "audit:core-choice-amount",
      eventAmount: 2,
      ...lookups,
    });
  const direct = run(initial, {
    ...choose,
    action: { ...choose.action, amount: 1 },
  });
  expect(direct.players[0].lifeNormalCoreCount).toBe(7);
  expect(direct.players[1].lifeNormalCoreCount).toBe(4);
  const pending = run(initial, choose);
  expect(pending.pendingCoreCountSelection?.continuation).toBeDefined();

  const action = getLegalActions({
    state: pending,
    actingPlayerId: "alice",
    ...lookups,
  }).find((a) => a.kind === "resolve_pending_core_count");
  expect(action).toBeDefined();
  const resumed = applyLegalAction({
    state: pending,
    action,
    coreCountSelection: 1,
    ...lookups,
  }).state;
  expect(resumed.pendingCoreCountSelection).toBeFalsy();
  expect(resumed.players[1].lifeNormalCoreCount).toBe(4);
  expect(resumed.players[0].lifeNormalCoreCount).toBe(7);
});

const get = (id) => ALL_CARDS.find((c) => c.cardNo === id);
const make = (id, instanceId, zone, cores = 0, owner = "alice") =>
  createCardInstance(get(id), {
    instanceId,
    ownerPlayerId: owner,
    zone,
    normalCoreCount: cores,
  });
const generic = {
  getCardDefinitionById: get,
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
};
it("BSLH01-C10 keeps increase-hand amount through accepting its optional draw", () => {
  let state = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingDeckCount: 1,
      cardInstances: [
        make("BSLH01-C10", "garcia", "field", 4),
        make("BSLH01-C02", "next", "deck"),
        ...Array.from({ length: 4 }, (_, i) =>
          make("BSLH01-C01", "bhand-" + i, "hand", 0, "bob")
        ),
      ],
    }),
    step: "main",
    activePlayerId: "bob",
  };
  const source = get("BSLH01-C10");
  const ix = source.effects.findIndex(
    (e) => e.timing.event === "increase_hand"
  );
  state = executeEffect({
    state,
    effect: source.effects[ix],
    effectIndex: ix,
    sourceInstanceId: "garcia",
    actingPlayerId: "alice",
    eventAmount: 2,
    chainId: "audit:garcia-optional",
    ...generic,
  });
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...generic,
  }).find(
    (a) =>
      a.kind === "resolve_pending_step_optional_choice" &&
      a.choice === "execute"
  );
  expect(action).toBeDefined();
  state = applyLegalAction({ state, action, ...generic }).state;
  expect(state.cardInstances.find((c) => c.instanceId === "next").zone).toBe(
    "hand"
  );
  expect(state.pendingZoneSelection).toMatchObject({
    actingPlayerId: "bob",
    maxCount: 2,
  });
});

it("BSSL01-T01 actual attack menu: discard choice draws regardless of how many cards qualify", () => {
  for (const [count, legacy] of [
    [1, false],
    [2, false],
    [2, true],
  ] as const) {
    const token = get("BSSL01-T01");
    const lookups = {
      ...generic,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([token]),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup([token]),
    };
    let state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        startingDeckCount: 1,
        cardInstances: [
          make("BSSL01-T01", "token", "field", 1),
          make("BSSL01-C03", "next", "deck"),
          ...Array.from({ length: count }, (_, i) =>
            make("BSSL01-C02", "eligible-" + i, "hand")
          ),
          make("BSDB01-C05", "victim", "field", 2, "bob"),
        ],
      }),
      step: "attack",
      window: "none",
      activePlayerId: "alice",
      turnNumber: 2,
    };
    const legal = (actingPlayerId = "alice") =>
      getLegalActions({ state, actingPlayerId, ...lookups });
    const apply = (action, extra = {}) => {
      expect(action).toBeDefined();
      state = applyLegalAction({ state, action, ...lookups, ...extra }).state;
    };
    apply(
      legal().find((a) => a.kind === "attack" && a.sourceInstanceId === "token")
    );
    for (
      let i = 0;
      i < 15 &&
      state.cardInstances.filter(
        (c) => c.instanceId.startsWith("eligible-") && c.zone === "trash"
      ).length === 0;
      i++
    ) {
      const menu = state.stackWindow
        ? legal(state.stackWindow.priorityPlayerId)
        : [...legal("alice"), ...legal("bob")];
      const immediate =
        menu.find(
          (a) =>
            a.kind === "resolve_battle_immediate_effect" &&
            a.choiceIndex === 1 &&
            !a.skipOnly
        ) ??
        menu.find(
          (a) =>
            a.kind === "resolve_battle_immediate_effect" &&
            a.choiceIndex === undefined &&
            !a.skipOnly
        );
      const choice = menu.find(
        (a) => a.kind === "resolve_pending_step_choice" && a.choiceIndex === 1
      );
      const zone = menu.find(
        (a) => a.kind === "resolve_pending_zone_selection"
      );
      const pass = menu.find(
        (a) =>
          a.kind === "pass_stack" ||
          a.kind === "pass_pre_declaration_stack" ||
          a.kind === "resolve_pending_burst_check" ||
          a.kind === "select_pending_to_resolve"
      );
      if (zone && legacy) {
        state = JSON.parse(JSON.stringify(state));
        delete state.pendingZoneSelection?.continuation?.stepContext
          .pendingStepChoice;
      }
      const action = zone ?? choice ?? pass ?? immediate;
      expect(
        action,
        JSON.stringify({
          menu,
          log: state.log.slice(-10),
          battle: state.battleImmediateEffects,
        })
      ).toBeDefined();
      apply(action, zone ? { selectedZoneCardIds: ["eligible-0"] } : {});
    }
    expect(
      state.cardInstances.find((c) => c.instanceId === "eligible-0").zone
    ).toBe("trash");
    expect(state.cardInstances.find((c) => c.instanceId === "next").zone).toBe(
      "hand"
    );
  }
});

it("BSTH02.7-C02: remove exactly three from trash with three versus four eligible targets", () => {
  const source = get("BSTH02.7-C02");
  for (const count of [3, 4]) {
    let state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          make(source.cardNo, "doll", "field", 1),
          make("BSDB01-C05", "victim", "field", 2, "bob"),
          ...Array.from({ length: count }, (_, i) =>
            make(source.cardNo, "eligible-" + i, "trash")
          ),
        ],
      }),
      step: "main",
      activePlayerId: "alice",
    };
    state = executeEffect({
      state,
      effect: source.effects[0],
      effectIndex: 0,
      sourceInstanceId: "doll",
      actingPlayerId: "alice",
      choiceIndex: 1,
      chainId: "audit:doll-exclusion",
      ...generic,
    });
    if (state.pendingZoneSelection) {
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...generic,
      }).find((a) => a.kind === "resolve_pending_zone_selection");
      expect(action).toBeDefined();
      state = applyLegalAction({
        state,
        action,
        selectedZoneCardIds: ["eligible-0", "eligible-1", "eligible-2"],
        ...generic,
      }).state;
    }
    expect(
      state.cardInstances.filter((c) => c.zone === "removed_from_game")
    ).toHaveLength(3);
    expect(
      state.activeContinuousEffects.some(
        (e) =>
          e.targetInstanceId === "victim" &&
          e.modifierTag === "override_properties"
      )
    ).toBe(true);
  }
});
