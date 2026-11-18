import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  createGameSnapshot,
  executeEffect,
  getLegalActions,
  restoreSnapshot,
  type CardDefinition,
  type EffectStep,
  type GameState,
  type LegalAction,
} from "../src";
import {
  buildBattleImmediateEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";

function fixture(
  options: {
    sameBucket?: boolean;
    child?: boolean;
    afterTriggers?: boolean;
    nested?: boolean;
    endBattle?: boolean;
    readyPeer?: boolean;
    nativeDormant?: boolean;
  } = {}
) {
  const base: CardDefinition = {
    cardNo: "DERIVED-ATTACKER",
    name: "attacker",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 0,
    reductionSymbols: [],
    symbolColors: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
  const count: EffectStep = {
    action: { kind: "count_increase", player: "self", amount: 1 },
  };
  const attacker: CardDefinition = {
    ...base,
    effects: [
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: options.endBattle
              ? { kind: "end_battle" }
              : { kind: "discard", player: "self", count: 1, unseen: true },
          },
          ...(options.child ? [count] : []),
          ...(options.afterTriggers
            ? [{ ...count, connector: "after_triggers" as const }]
            : []),
        ],
      },
      ...(options.sameBucket
        ? []
        : [
            {
              timing: {
                kind: "card_event" as const,
                event: "attack" as const,
                ...(options.endBattle
                  ? { deferredTo: "battle_end" as const }
                  : {}),
              },
              steps: options.endBattle
                ? [
                    {
                      action: {
                        kind: "discard" as const,
                        player: "self" as const,
                        count: 1,
                        unseen: true,
                      },
                    },
                  ]
                : [{ action: { kind: "draw" as const, count: 1 } }],
            },
          ]),
      ...(options.readyPeer
        ? [
            {
              timing: { kind: "card_event" as const, event: "attack" as const },
              steps: [
                {
                  action: {
                    kind: "discard" as const,
                    player: "self" as const,
                    count: 1,
                    unseen: true,
                  },
                },
              ],
            },
          ]
        : []),
    ],
  };
  const observer: CardDefinition = {
    ...base,
    cardNo: "DERIVED-TRASH",
    name: "trash observer",
    printedCategory: "magic",
    levelDefs: [],
    effects: [
      {
        timing: { kind: "game_event", event: "attack", player: "self" },
        applicability: { zone: "trash" },
        executionMode: "optional",
        condition: [{ kind: "hand_count", player: "self", max: 5 }],
        steps: [
          ...(options.nested ? [count] : []),
          { action: { kind: "move_self", destination: "hand" } },
        ],
      },
      ...(options.sameBucket
        ? [
            {
              timing: {
                kind: "game_event" as const,
                event: "attack" as const,
                player: "self" as const,
              },
              applicability: { zone: "trash" as const },
              steps: [count],
            },
          ]
        : []),
    ],
  };
  const child: CardDefinition = {
    ...base,
    cardNo: "DERIVED-CHILD",
    name: "child",
    printedCategory: "nexus",
    levelDefs: [{ level: 1, requiredCores: 0 }],
    effects: [
      {
        timing: {
          kind: "game_event",
          event: options.nested ? "attack" : "count_increase",
          player: "self",
        },
        ...(options.nested
          ? {
              condition: [
                {
                  kind: "count_value" as const,
                  player: "self" as const,
                  min: 1,
                },
              ],
            }
          : {}),
        executionMode: "optional",
        steps: [{ action: { kind: "noop" } }],
      },
    ],
  };
  const fodder = { ...base, cardNo: "DERIVED-FODDER", effects: [] };
  const defs = [attacker, observer, child, fodder];
  const deps = {
    getCardDefinitionById: (id: string) => defs.find((d) => d.cardNo === id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(defs),
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredBurstActions: () => [],
  };
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ handCount: 6, deckCount: 1 }, {}],
      cardInstances: [
        createCardInstance(attacker, {
          instanceId: "attacker",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(observer, {
          instanceId: "observer",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
        createCardInstance(fodder, {
          instanceId: "deck",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        ...Array.from({ length: 6 }, (_, i) =>
          createCardInstance(fodder, {
            instanceId: "hand-" + i,
            ownerPlayerId: "alice",
            zone: "hand",
          })
        ),
        ...(options.child || options.nested
          ? [
              createCardInstance(child, {
                instanceId: "child",
                ownerPlayerId: "alice",
                zone: "field",
              }),
            ]
          : []),
      ],
    }),
    step: "attack",
    window: "none",
    turnNumber: 3,
  };
  const actions = () =>
    ["alice", "bob"].flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...deps })
    );
  const act = (
    select: (a: LegalAction) => boolean,
    skipOptionalEffect = false
  ) => {
    const action = actions().find(select);
    expect(action, JSON.stringify(actions())).toBeDefined();
    state = applyLegalAction({
      state,
      action: action!,
      ...deps,
      skipOptionalEffect,
    }).state;
  };
  const passStacks = () => {
    for (let n = 0; state.stackWindow && n < 16; n++)
      act((a) => a.kind === "pass_stack");
    expect(state.stackWindow).toBeNull();
  };
  const restore = () => {
    state = restoreSnapshot(
      JSON.parse(JSON.stringify(createGameSnapshot(state))),
      deps.getCardDefinitionById,
      deps
    ).state;
  };
  if (options.nativeDormant) {
    state = executeEffect({
      state,
      sourceInstanceId: "attacker",
      actingPlayerId: "alice",
      chainId: "grant-setup",
      effect: {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "grant_effect",
              target: { kind: "self" },
              duration: { scope: "turn" },
              grantedEffect: {
                timing: { kind: "card_event", event: "attack" },
                executionMode: "optional",
                condition: [{ kind: "hand_count", player: "self", max: 0 }],
                steps: [count],
              },
            },
          },
        ],
      },
      ...deps,
    });
  }
  act((a) => a.kind === "attack");
  for (let n = 0; state.preDeclarationStackWindow && n < 12; n++)
    act((a) => a.kind === "pass_pre_declaration_stack");
  const original = state.pendingTriggeredEffects.find(
    (p) => p.timingSourceRegistrations?.["observer#0"]
  )!;
  if (options.nativeDormant) {
    // Exercise native collection with the same declaration event before testing entry.
    state = collectAndQueueTriggerReactions({
      beforeState: state,
      afterState: state,
      chainId: original.chainId,
      source: "action_resolution",
      supplementalEvents: [original],
      simultaneousGroupId: original.simultaneousGroupId!,
      ...deps,
    });
  }
  const enable = () => {
    act(
      (a) =>
        a.kind === "resolve_battle_immediate_effect" &&
        a.promptId.endsWith(":0")
    );
    passStacks();
  };
  const outer = (a: LegalAction) =>
    a.kind === "resolve_battle_immediate_effect" && a.promptId.endsWith(":1");
  const resolveObserver = (skip = false) => {
    act(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "observer" &&
        a.registrationIndex === 0,
      skip
    );
    passStacks();
  };
  return {
    get state() {
      return state;
    },
    original,
    actions,
    act,
    passStacks,
    restore,
    enable,
    outer,
    resolveObserver,
  };
}

describe("Q30415: newly met conditions have derived priority", () => {
  it("resolves a trash return before an outer draw could remove its qualification", () => {
    const f = fixture();
    f.enable();
    expect(f.state.players[0]!.handCount).toBe(5);
    expect(f.actions().some(f.outer)).toBe(false);
    const derived = f.state.pendingTriggeredEffects.find(
      (p) => p.activationPriority
    )!;
    expect(derived).toMatchObject({
      chainId: f.original.chainId,
      simultaneousGroupId: f.original.simultaneousGroupId,
      activationPriority: { originalPendingId: f.original.pendingId },
    });
    expect(derived.activationPriority!.simultaneousGroupId).not.toBe(
      f.original.simultaneousGroupId
    );
    f.resolveObserver();
    expect(
      f.state.cardInstances.find((c) => c.instanceId === "observer")!.zone
    ).toBe("hand");
    expect(f.actions().some(f.outer)).toBe(true);
  });
  it("can decline the child, then returns to the outer draw", () => {
    const f = fixture();
    f.enable();
    f.resolveObserver(true);
    expect(f.actions().some(f.outer)).toBe(true);
    f.act(f.outer);
    f.passStacks();
    expect(f.state.players[0]!.handCount).toBe(6);
    expect(
      f.state.cardInstances.find((c) => c.instanceId === "observer")!.zone
    ).toBe("trash");
  });
  it("splits only newly enabled registrations out of a shared owner/event bucket", () => {
    const f = fixture({ sameBucket: true });
    f.enable();
    expect(
      f
        .actions()
        .filter((a) => a.kind === "resolve_pending_triggered_effect")
        .map((a) => a.registrationIndex)
    ).toEqual([0]);
    f.resolveObserver(true);
    expect(
      f
        .actions()
        .some(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            a.registrationIndex === 1
        )
    ).toBe(true);
    f.act(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.registrationIndex === 1
    );
    f.passStacks();
    expect(
      f
        .actions()
        .some(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            a.sourceInstanceId === "observer"
        )
    ).toBe(false);
  });
  it("does not restore an already resolved registration when its dormant peer is promoted", () => {
    const f = fixture({ sameBucket: true });
    f.act(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.registrationIndex === 1
    );
    f.passStacks();
    f.enable();
    expect(
      f
        .actions()
        .filter((a) => a.kind === "resolve_pending_triggered_effect")
        .map((a) => a.registrationIndex)
    ).toEqual([0]);
    f.resolveObserver(true);
    expect(
      f
        .actions()
        .some(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            a.sourceInstanceId === "observer"
        )
    ).toBe(false);
  });
  it("puts a newly met condition beside other reactions from the enabling effect", () => {
    const f = fixture({ child: true });
    f.enable();
    const sources = f
      .actions()
      .filter(
        (a) =>
          a.kind === "select_pending_to_resolve" ||
          a.kind === "resolve_pending_triggered_effect"
      )
      .map((a) => a.sourceInstanceId);
    expect([...new Set(sources)].sort()).toEqual(["child", "observer"]);
    expect(f.actions().some(f.outer)).toBe(false);
  });
  it("keeps priority across a declared stack and formal restore", () => {
    const f = fixture();
    f.enable();
    f.act(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "observer"
    );
    expect(f.state.stackWindow).not.toBeNull();
    f.restore();
    f.passStacks();
    expect(
      f.state.cardInstances.find((c) => c.instanceId === "observer")!.zone
    ).toBe("hand");
    expect(f.actions().some(f.outer)).toBe(true);
  });
  it("drains the child before an after_triggers continuation resumes", () => {
    const f = fixture({ afterTriggers: true });
    f.enable();
    expect(f.state.players[0]!.countValue).toBe(0);
    expect(f.actions().some(f.outer)).toBe(false);
    f.restore();
    f.resolveObserver(true);
    expect(f.state.players[0]!.countValue).toBe(1);
    expect(f.actions().some(f.outer)).toBe(true);
  });
  it("keeps other dormant observations alive through nested derived effects", () => {
    const f = fixture({ nested: true });
    f.enable();
    expect(f.actions().some(f.outer)).toBe(false);
    f.resolveObserver();
    expect(
      f
        .actions()
        .some(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            a.sourceInstanceId === "child"
        )
    ).toBe(true);
    expect(f.actions().some(f.outer)).toBe(false);
    f.act(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "child",
      true
    );
    f.passStacks();
    expect(f.actions().some(f.outer)).toBe(true);
  });
  it("closes an old attack observation before a battle-end deferral meets its condition", () => {
    const f = fixture({ endBattle: true });
    f.act(f.outer);
    f.passStacks();
    f.enable();
    expect(f.state.players[0]!.handCount).toBe(5);
    expect(
      f.state.cardInstances.find((c) => c.instanceId === "observer")!.zone
    ).toBe("trash");
    expect(f.state.pendingTriggeredEffects).toEqual([]);
    expect(f.state.pendingImmediateBattleEnds).toEqual([]);
    expect(f.state.log.some((line) => line.startsWith("battle:end:"))).toBe(
      true
    );
  });
  it("drains ready old reactions and their children before closing the attack timing", () => {
    const f = fixture({ endBattle: true, readyPeer: true });
    f.act(f.outer);
    f.passStacks();
    f.enable();
    expect(f.state.players[0]!.handCount).toBe(6);
    expect(
      f.state.log.some((line) => line.startsWith("battle:end-deferral:fire:"))
    ).toBe(false);
    f.act(
      (a) =>
        a.kind === "resolve_battle_immediate_effect" &&
        a.promptId.endsWith(":2")
    );
    f.passStacks();
    expect(f.state.players[0]!.handCount).toBe(5);
    expect(
      f.state.log.some((line) => line.startsWith("battle:end-deferral:fire:"))
    ).toBe(false);
    f.resolveObserver(true);
    expect(f.state.players[0]!.handCount).toBe(4);
    expect(f.state.pendingImmediateBattleEnds).toEqual([]);
    expect(f.state.log.some((line) => line.startsWith("battle:end:"))).toBe(
      true
    );
  });
  it("does not let an unqualified native observation deadlock battle-end entry", () => {
    const f = fixture({ endBattle: true, nativeDormant: true });
    expect(
      f.state.pendingTriggeredEffects.some(
        (pending) =>
          pending.mechanic?.kind === "granted_effect" && pending.dormantMechanic
      )
    ).toBe(true);
    f.act(f.outer);
    f.passStacks();
    f.enable();
    expect(f.state.pendingTriggeredEffects).toEqual([]);
    expect(f.state.pendingImmediateBattleEnds).toEqual([]);
    expect(f.state.log.some((line) => line.startsWith("battle:end:"))).toBe(
      true
    );
  });
});
