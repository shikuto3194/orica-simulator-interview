import { executeEffect } from "../src/effect/effect-interpreter";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  getLegalActions,
  joinActiveAttackAsAction,
} from "../src";
import type { GameState, LegalAction, TriggerEventKind } from "../src/model";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import {
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  expandCardDefinitionsWithBackFaces,
} from "../src/effect/structured-effect-registrations";
import {
  collectAndQueueTriggerReactions,
  getAvailableTriggeredEffectSourceChoices,
  queuePendingReactionsFromTriggerEvents,
} from "../src/effect/trigger-system";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const byId = new Map(definitions.map((d) => [d.cardNo, d]));
const lookups = {
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredMagicActions: () => [],
  getRegisteredBurstActions: () => [],
  getCardDefinitionById: (id: string) => byId.get(id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(definitions),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(definitions),
};
function instance(cardNo: string, id: string, cores = 0) {
  return createCardInstance(byId.get(cardNo)!, {
    instanceId: id,
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: cores,
  });
}
function queue(
  state: GameState,
  eventKind: TriggerEventKind,
  relatedInstanceId: string,
  group = "test-cause"
) {
  const queued = queuePendingReactionsFromTriggerEvents(
    state,
    [
      {
        actingPlayerId: "alice",
        eventKind,
        source: "action_resolution",
        chainId: "test-effect",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId,
        amount: null,
      },
    ],
    group,
    lookups
  );
  return { ...queued, pendingBurstChecks: [] };
}
function sources(state: GameState) {
  return state.pendingTriggeredEffects.flatMap((pendingEffect) =>
    getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect,
      ...lookups,
    }).map((s) => s.sourceCard.instanceId)
  );
}
function act(state: GameState, predicate: (a: LegalAction) => boolean) {
  const actions = ["alice", "bob"].flatMap((actingPlayerId) =>
    getLegalActions({ state, actingPlayerId, ...lookups })
  );
  const action = actions.find(predicate);
  expect(action, JSON.stringify(actions)).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups }).state;
}
function passStacks(state: GameState): GameState {
  for (let i = 0; state.stackWindow && i < 8; i++) {
    state = act(state, (a) => a.kind === "pass_stack");
  }
  expect(state.stackWindow).toBeNull();
  return state;
}
function resolveSource(
  state: GameState,
  source: string,
  skip = false,
  pendingId?: string
) {
  const selections = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  });
  if (selections.some((a) => a.kind === "select_pending_to_resolve")) {
    state = act(
      state,
      (a) =>
        a.kind === "select_pending_to_resolve" &&
        a.sourceInstanceId === source &&
        (pendingId === undefined || a.pendingId === pendingId)
    );
    state = { ...state, pendingBurstChecks: [] };
    if (state.stackWindow) return passStacks(state);
  }
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  }).find(
    (a) =>
      a.kind === "resolve_pending_triggered_effect" &&
      a.sourceInstanceId === source &&
      (pendingId === undefined || a.pendingId === pendingId)
  );
  expect(
    action,
    JSON.stringify({
      actions: getLegalActions({ state, actingPlayerId: "alice", ...lookups }),
      log: state.log.slice(-10),
      stack: state.stackWindow,
      pending: state.pendingTriggeredEffects,
    })
  ).toBeDefined();
  return passStacks(
    applyLegalAction({
      state,
      action: action!,
      skipOptionalEffect: skip,
      ...lookups,
    }).state
  );
}
function completeCore(state: GameState, id: string) {
  state = act(
    state,
    (a) =>
      a.kind === "resolve_brave_combine_choice" &&
      a.chosenHostInstanceId === null
  );
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  }).find((a) => a.kind === "resolve_pending_core_distribution");
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    coreDistributionAllocations: { [id]: 1 },
    coreDistributionSourceAllocations: { reserve: 1 },
    ...lookups,
  }).state;
}
function summonQueue() {
  return queue(
    {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          instance("BSSA01-転醒X01(A)", "x01"),
          instance("BSSA01-転醒X04(A)", "x04"),
          instance("BSSA01-X02", "host", 2),
        ],
        playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
      }),
      step: "main",
      turnNumber: 3,
    },
    "summon",
    "host"
  );
}

describe("転醒の同一原因排他", () => {
  function attackQueue(attacker = "BSTH07-転醒X01(A)", nexusOwner = "alice") {
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          instance(attacker, "attacker", 3),
          {
            ...instance("BSTH03-転醒R01(A)", "exhaust-nexus"),
            ownerPlayerId: nexusOwner,
            controllerPlayerId: nexusOwner,
          },
          {
            ...instance("BSTH06-転醒R01(A)", "attack-nexus"),
            ownerPlayerId: nexusOwner,
            controllerPlayerId: nexusOwner,
          },
        ],
      }),
      step: "attack",
      window: "none",
      turnNumber: 3,
    };
    state = act(
      state,
      (a) => a.kind === "attack" && a.sourceInstanceId === "attacker"
    );
    while (state.preDeclarationStackWindow) {
      state = act(state, (a) => a.kind === "pass_pre_declaration_stack");
    }
    return { ...state, pendingBurstChecks: [] };
  }

  it.each(["attacker", "exhaust-nexus", "attack-nexus"])(
    "同じアタックの疲労・アタック転醒は%sを先に発揮すると残りが消える",
    (first) => {
      let state = attackQueue();
      expect(sources(state)).toEqual(
        expect.arrayContaining(["exhaust-nexus", "attack-nexus"])
      );
      expect(
        state.battleImmediateEffects.some(
          (p) => p.sourceInstanceId === "attacker"
        )
      ).toBe(true);
      if (first === "attacker") {
        state = act(
          state,
          (a) =>
            (a.kind === "resolve_battle_immediate_effect" ||
              a.kind === "select_pending_to_resolve") &&
            a.sourceInstanceId === first
        );
        state = passStacks(state);
      } else {
        state = resolveSource(state, first);
      }
      expect(
        state.cardInstances.find((c) => c.instanceId === first)?.definitionId
      ).toMatch(/\(B\)$/);
      expect(state.players[0]!.countValue).toBe(1);
      if (first !== "attacker") state = resolveSource(state, first);
      const remaining = sources({
        ...state,
        pendingTriggeredEffects: state.pendingTriggeredEffects.filter(
          (p) => p.eventKind === "attack" || p.eventKind === "exhaust"
        ),
      });
      expect(remaining).not.toContain("exhaust-nexus");
      expect(remaining).not.toContain("attack-nexus");
      const actions = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lookups,
      });
      expect(
        actions.some(
          (a) =>
            a.kind === "resolve_battle_immediate_effect" &&
            a.sourceInstanceId === "attacker"
        )
      ).toBe(false);
    }
  );

  function resolveAttackRebirth(state: GameState, skip = false) {
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (a) =>
        a.kind === "resolve_battle_immediate_effect" &&
        a.sourceInstanceId === "attacker"
    );
    expect(action).toBeDefined();
    return passStacks(
      applyLegalAction({
        state,
        action: action!,
        skipOptionalEffect: skip,
        ...lookups,
      }).state
    );
  }

  it("アタック転醒を辞退しても同じ宣言による疲労転醒を発揮できる", () => {
    let state = resolveAttackRebirth(attackQueue(), true);
    expect(state.players[0]!.countValue).toBe(0);
    state = resolveSource(state, "exhaust-nexus");
    expect(
      state.cardInstances.find((c) => c.instanceId === "exhaust-nexus")
        ?.definitionId
    ).toBe("BSTH03-転醒R01(B)");
    expect(state.players[0]!.countValue).toBe(1);
  });

  it("同じバトル中でも後続効果による疲労は別原因として転醒できる", () => {
    const initial = attackQueue();
    const group = initial.pendingTriggeredEffects[0]!.simultaneousGroupId!;
    let state = resolveAttackRebirth(initial);
    expect(sources({ ...state, log: [] })).not.toContain("exhaust-nexus");
    const before = {
      ...state,
      log: [],
      cardInstances: [
        ...state.cardInstances,
        instance("BSSA01-X02", "later-exhaust", 2),
      ],
    };
    state = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: {
        ...before,
        cardInstances: before.cardInstances.map((c) =>
          c.instanceId === "later-exhaust"
            ? { ...c, exhaustState: "exhausted" as const }
            : c
        ),
      },
      source: "action_resolution",
      chainId: "later-exhaust-effect",
      attackId: state.activeAttack!.attackId,
      simultaneousGroupId: group,
      ...lookups,
    });
    expect(sources(state)).toContain("exhaust-nexus");
    state = resolveSource(state, "exhaust-nexus");
    expect(
      state.cardInstances.find((c) => c.instanceId === "exhaust-nexus")
        ?.definitionId
    ).toBe("BSTH03-転醒R01(B)");
    expect(state.players[0]!.countValue).toBe(2);
  });

  it("一方のプレイヤーが転醒しても相手の疲労・アタック転醒を消費しない", () => {
    const state = resolveAttackRebirth(attackQueue("BSTH07-転醒X01(A)", "bob"));
    expect(sources(state)).toEqual(
      expect.arrayContaining(["exhaust-nexus", "attack-nexus"])
    );
    expect(state.players.map((p) => p.countValue)).toEqual([1, 0]);
  });

  it("疲労転醒後も通常のアタック時効果を発揮でき、アタック転醒だけが消える", () => {
    let state = resolveSource(
      attackQueue("BSTH08-転醒R01(A)"),
      "exhaust-nexus"
    );
    state = resolveSource(state, "exhaust-nexus"); // B面の転醒時を解決して元の同時誘発へ戻る。
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).filter(
      (a) =>
        a.kind === "resolve_battle_immediate_effect" &&
        a.sourceInstanceId === "attacker" &&
        !a.skipOnly
    );
    expect(
      actions,
      JSON.stringify(
        getLegalActions({ state, actingPlayerId: "alice", ...lookups })
      )
    ).toHaveLength(1);
    state = passStacks(
      applyLegalAction({ state, action: actions[0]!, ...lookups }).state
    );
    // 相手の破壊対象がいなくても、破壊を辞退して独立した任意コア配置を選べる。
    expect(state.pendingStepOptionalChoice?.stepIndex).toBe(0);
    state = act(
      state,
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "decline"
    );
    expect(state.pendingStepOptionalChoice?.stepIndex).toBe(1);
    state = act(
      state,
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(
      state.cardInstances.find((c) => c.instanceId === "attacker")
        ?.normalCoreCount
    ).toBe(4);
    expect(state.players[0]!.countValue).toBe(1);
  });
  it.each(["exhaust-nexus", "attack-nexus"])(
    "合法な途中合流の%s転醒が成立したら同じ合流の他候補を除く",
    (first) => {
      let state: GameState = attackQueue("BSTH06-C01");
      // Primary宣言の誘発を辞退済みとし、実カードの導域で後続の合流を許可する。
      state = {
        ...state,
        pendingTriggeredEffects: [],
        battleImmediateEffects: [],
        pendingPromptLock: null,
        summonedDuringAttackStepInstanceIds: ["joiner"],
        pendingImmediateAttackJoins: [
          {
            attackId: state.activeAttack!.attackId,
            sourceInstanceId: "joiner",
          },
        ],
        cardInstances: [
          ...state.cardInstances,
          instance("BSTH07.8-C01", "joiner", 1),
          instance("BSTH07.8-XX01", "join-grant"),
        ],
      };
      state = executeEffect({
        chainId: "test:rebirth-same-cause-queue:407",
        state,
        effect: byId.get("BSTH07.8-XX01")!.effects![1]!,
        sourceInstanceId: "join-grant",
        actingPlayerId: "alice",
        ...lookups,
      });
      state = act(
        state,
        (a) =>
          a.kind === "join_active_attack" && a.sourceInstanceId === "joiner"
      );
      while (state.preDeclarationStackWindow) {
        state = act(state, (a) => a.kind === "pass_pre_declaration_stack");
      }
      state = { ...state, pendingBurstChecks: [] };
      expect(sources(state)).toEqual(
        expect.arrayContaining(["exhaust-nexus", "attack-nexus"])
      );
      state = resolveSource(state, first);
      state = resolveSource(state, first); // B面の転醒時まで解決する。
      expect(state.players[0]!.countValue).toBe(1);
      expect(
        state.cardInstances.find((c) => c.instanceId === first)?.definitionId
      ).toMatch(/\(B\)$/);
      const other =
        first === "exhaust-nexus" ? "attack-nexus" : "exhaust-nexus";
      expect(
        state.cardInstances.find((c) => c.instanceId === other)?.definitionId
      ).toMatch(/\(A\)$/);
      expect(
        state.pendingTriggeredEffects.some(
          (p) => p.eventKind === "attack" || p.eventKind === "exhaust"
        )
      ).toBe(false);
    }
  );

  it.each(["joiner", "exhaust-nexus"])(
    "先行アタックで転醒済みでも後続合流の%s転醒は成立し、同じ合流の候補だけ消える",
    (first) => {
      let state = resolveAttackRebirth(attackQueue());
      const attackId = state.activeAttack!.attackId;
      state = joinActiveAttackAsAction({
        state: {
          ...state,
          cardInstances: [
            ...state.cardInstances,
            instance("BSTH07-転醒X01(A)", "joiner", 3),
          ],
        },
        actingPlayerId: "alice",
        sourceInstanceId: "joiner",
        ...lookups,
      }).state;
      state = { ...state, pendingBurstChecks: [] };
      expect(state.activeAttack!.attackId).toBe(attackId);
      expect(sources(state)).toEqual(
        expect.arrayContaining(["exhaust-nexus", "attack-nexus"])
      );
      if (first === "joiner") {
        state = act(
          state,
          (a) =>
            a.kind === "resolve_battle_immediate_effect" &&
            a.sourceInstanceId === "joiner" &&
            !a.skipOnly
        );
        state = passStacks(state);
      } else {
        state = resolveSource(state, first);
        state = resolveSource(state, first);
      }
      expect(
        state.cardInstances.find((c) => c.instanceId === first)?.definitionId
      ).toMatch(/\(B\)$/);
      expect(state.players[0]!.countValue).toBe(2);
      expect(
        state.battleImmediateEffects.some(
          (p) => p.sourceInstanceId === "joiner"
        )
      ).toBe(false);
      expect(sources(state)).not.toContain("exhaust-nexus");
      expect(sources(state)).not.toContain("attack-nexus");
    }
  );
  it("X02召喚時の後続召喚で先に転醒しても、先行召喚の未転醒カードは残る", () => {
    let state = summonQueue();
    const originalPendingId = state.pendingTriggeredEffects[0]!.pendingId;
    state = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        { ...instance("BSSA01-X02", "later-host"), zone: "hand" },
      ],
      players: state.players.map((p) =>
        p.id === "alice" ? { ...p, handCount: 1 } : p
      ),
    };
    const summonEffect = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "host" &&
        a.registrationIndex === 0
    );
    expect(summonEffect).toBeDefined();
    state = passStacks(
      applyLegalAction({
        state,
        action: summonEffect!,
        targetInstanceIds: ["later-host"],
        ...lookups,
      }).state
    );
    for (let i = 0; i < 10 && state.pendingMultiPlacement !== null; i++) {
      const actions = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lookups,
      });
      const action = actions.find(
        (a) =>
          a.kind === "resolve_pending_effect_target_selection" ||
          a.kind === "resolve_pending_multi_placement"
      );
      expect(action, JSON.stringify(actions)).toBeDefined();
      state = applyLegalAction({
        state,
        action: action!,
        targetInstanceIds: ["later-host"],
        multiPlacementAllocations: [
          {
            destinationInstanceId: "later-host",
            placements: [{ kind: "reserve_normal", amount: 1 }],
          },
        ],
        ...lookups,
      }).state;
    }
    expect(
      state.cardInstances.find((c) => c.instanceId === "later-host")?.zone
    ).toBe("field");
    state = { ...state, pendingBurstChecks: [] };
    const later = state.pendingTriggeredEffects.find(
      (p) => p.eventKind === "summon" && p.pendingId !== originalPendingId
    );
    expect(later, JSON.stringify(state.pendingTriggeredEffects)).toBeDefined();
    state = resolveSource(state, "x04", false, later!.pendingId);
    state = completeCore(state, "x04");
    const earlier = state.pendingTriggeredEffects.find(
      (p) => p.pendingId === originalPendingId
    );
    expect(earlier).toBeDefined();
    const earlierSources = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: earlier!,
      ...lookups,
    }).map((c) => c.sourceCard.instanceId);
    expect(earlierSources).toContain("x01");
    expect(earlierSources).not.toContain("x04");
    state = resolveSource(state, "x01", false, originalPendingId);
    state = completeCore(state, "x01");
    expect(state.players[0]!.countValue).toBe(2);
  });

  it("TR02のアタック時で黄カード破棄とライフ増加を満たしたTR01/TR02は両方転醒する", () => {
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          instance("BSTH02.7-TR01(A)", "tr01", 1),
          instance("BSTH02.7-TR02(A)", "tr02", 2),
          ...["deck1", "deck2"].map((id) => ({
            ...instance("BSTH02.7-C01", id),
            zone: "deck" as const,
          })),
        ],
        playerOverrides: [
          { reserveNormalCoreCount: 5, trashNormalCoreCount: 1, deckCount: 2 },
          {},
        ],
      }),
      step: "attack",
      turnNumber: 3,
    };
    const before = state;
    state = executeEffect({
      chainId: "test:rebirth-same-cause-queue:597",
      state,
      effect: byId.get("BSTH02.7-TR02(A)")!.effects![1]!,
      sourceInstanceId: "tr02",
      actingPlayerId: "alice",
      ...lookups,
      getRegisteredTriggeredEffectActions: () => [],
    });
    while (state.pendingStepOptionalChoice) {
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lookups,
      }).find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "execute"
      );
      expect(action).toBeDefined();
      state = applyLegalAction({
        state,
        action: action!,
        ...lookups,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
    }
    state = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: state,
      source: "action_resolution",
      chainId: "matryoshka-attack",
      ...lookups,
      getRegisteredBurstActions: undefined,
    });
    expect(state.players[0]!.lifeNormalCoreCount).toBe(6);
    expect(state.cardInstances.filter((c) => c.zone === "trash")).toHaveLength(
      2
    );
    expect(sources(state)).toEqual(expect.arrayContaining(["tr01", "tr02"]));
    expect(
      new Set(state.pendingTriggeredEffects.map((p) => p.simultaneousGroupId))
        .size
    ).toBe(1);
    state = resolveSource(state, "tr02");
    expect(sources(state)).toContain("tr01");
    // TR02から派生したB面の転醒時を先に辞退してから、外側のTR01へ戻る。
    state = resolveSource(state, "tr02", true);
    state = resolveSource(state, "tr01");
    if (state.pendingCoreDistribution) {
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lookups,
      }).find((a) => a.kind === "resolve_pending_core_distribution");
      expect(action).toBeDefined();
      state = applyLegalAction({
        state,
        action: action!,
        coreDistributionAllocations: {},
        coreDistributionSourceAllocations: {},
        ...lookups,
      }).state;
    }
    expect(
      state.cardInstances.find((c) => c.instanceId === "tr01")?.definitionId
    ).toBe("BSTH02.7-TR01(B)");
    expect(
      state.cardInstances.find((c) => c.instanceId === "tr02")?.definitionId
    ).toBe("BSTH02.7-TR02(B)");
    expect(state.players[0]!.countValue).toBe(2);
  });

  it("X04の転醒確定後は同じ召喚のX01を候補から除去し、通常召喚時効果は残す", () => {
    let state = summonQueue();
    expect(sources(state)).toEqual(
      expect.arrayContaining(["x01", "x04", "host"])
    );
    state = resolveSource(state, "x04");
    state = completeCore(state, "x04");
    expect(
      state.cardInstances.find((c) => c.instanceId === "x04")?.definitionId
    ).toBe("BSSA01-転醒X04(B)");
    expect(sources(state)).not.toContain("x01");
    expect(sources({ ...state, log: [] })).not.toContain("x01");
    expect(sources(state)).toContain("host");
  });

  it("同じグループでも原因が召喚と煌臨なら両方転醒できる", () => {
    let state = queue(summonQueue(), "advent", "host");
    state = resolveSource(state, "x04");
    state = completeCore(state, "x04");
    state = resolveSource(state, "x01");
    state = completeCore(state, "x01");
    expect(
      state.cardInstances.find((c) => c.instanceId === "x01")?.definitionId
    ).toBe("BSSA01-転醒X01(B)");
    expect(
      state.cardInstances.find((c) => c.instanceId === "x04")?.definitionId
    ).toBe("BSSA01-転醒X04(B)");
    expect(state.players[0]!.countValue).toBe(2);
  });
});
