import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  queueRegisteredBattleImmediateEffects,
  moveNormalCores,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "../src";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";

function setup(timing: "attack" | "block", pauseAfterCores = false) {
  const source: CardDefinition = {
    ...ALL_CARDS.find((card) => card.cardNo === "BSDB01-C02")!,
    cardNo: "TIMING-LEVEL",
    name: "レベル上昇テスト",
    adventData: undefined,
    effects: [
      {
        timing: { kind: "card_event", event: timing },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "this_card" },
              amount: 1,
            },
          },
        ],
      },
      {
        timing: { kind: "card_event", event: timing },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
      {
        timing: { kind: "card_event", event: timing },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
  if (pauseAfterCores) {
    source.effects[0]!.steps.push({
      action: { kind: "draw", count: 1 },
      executionMode: "optional",
    });
  }
  const observer: CardDefinition = {
    ...source,
    cardNo: "TIMING-OBSERVER",
    name: "コア増加の反応",
    effects: [
      {
        timing: {
          kind: "game_event",
          event: "void_core_decrease",
          player: "self",
        },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 10 } },
        ],
      },
    ],
  };
  if (pauseAfterCores) {
    observer.effects.push({
      timing: { kind: "game_event", event: "increase_hand", player: "self" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 20 } },
      ],
    });
  }
  const definitions = new Map(
    [source, observer].map((card) => [card.cardNo, card])
  );
  const lookups = {
    getCardDefinitionById: (id: string) => definitions.get(id),
    getRegisteredBattleImmediateEffectActions: buildBattleImmediateEffectLookup(
      [source, observer]
    ),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
      source,
      observer,
    ]),
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredBurstActions: undefined,
  };
  const owner = timing === "attack" ? "alice" : "bob";
  const sourceCard = createCardInstance(source, {
    instanceId: "source",
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: 1,
    exhaustState: "exhausted",
  });
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        sourceCard,
        createCardInstance(observer, {
          instanceId: "observer",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
      playerOverrides: [{ deckCount: 5 }, { deckCount: 5 }],
    }),
    turnNumber: 3,
    activePlayerId: "alice",
    step: "attack",
    window: timing === "attack" ? "declare_attack" : "declare_block",
    battleEntities: [
      {
        entityId: "entity",
        memberInstanceIds: ["source"],
        resolvedBp: 5000,
        resolvedSymbols: ["blue"],
        attackState: timing === "attack" ? "attacking" : "blocking",
      },
    ],
    activeAttack: {
      attackId: "test-attack",
      primaryEntityId: "entity",
      participantEntityIds: ["entity"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [],
      symbolResolutionOrder: ["entity"],
      flashBeforeBlockCompleted: timing === "block",
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    },
  };
  const queued = queueRegisteredBattleImmediateEffects({
    state,
    attackId: "test-attack",
    participantEntityId: "entity",
    actingPlayerId: owner,
    sourceCard,
    sourceDefinition: source,
    timing,
    simultaneousGroupId: "declaration",
    ...lookups,
  });
  const actions = (current: GameState, playerId = owner) =>
    getLegalActions({ state: current, actingPlayerId: playerId, ...lookups });
  const apply = (
    current: GameState,
    match: (action: LegalAction) => boolean,
    playerId = owner
  ) => {
    const action = actions(current, playerId).find(match);
    expect(action, JSON.stringify(actions(current, playerId))).toBeDefined();
    return applyLegalAction({ state: current, action: action!, ...lookups })
      .state;
  };
  const resolve = (current: GameState, index: number) => {
    let after = apply(
      current,
      (action) =>
        action.kind === "resolve_battle_immediate_effect" &&
        action.promptId.endsWith(":" + index)
    );
    for (let i = 0; after.stackWindow && i < 5; i++)
      after = apply(
        after,
        (action) => action.kind === "pass_stack",
        after.stackWindow.priorityPlayerId
      );
    return after;
  };
  return { queued, lookups, owner, actions, apply, resolve };
}

describe("アタック/ブロック時解決中の条件達成", () => {
  it("派生Lv効果を先に解決しても、残った同時反応が終わるまで元の効果群へ戻らない", () => {
    const { queued, resolve, actions, apply } = setup("attack");
    const after = resolve(queued, 0);
    const reaction = after.pendingTriggeredEffects[0]!;
    // 元の宣言時にも反応効果が残っている盤面。
    const withOriginalReaction: GameState = {
      ...after,
      pendingTriggeredEffects: [
        {
          ...reaction,
          pendingId: "original-reaction",
          chainId: "test:battle-timing-reevaluation:outer",
          simultaneousGroupId: "declaration",
        },
        ...after.pendingTriggeredEffects,
      ],
    };
    let finished = resolve(withOriginalReaction, 1);
    const remaining = actions(finished);
    expect(remaining.map((action) => action.kind)).toEqual([
      "resolve_pending_triggered_effect",
    ]);
    expect(remaining[0]).toMatchObject({ pendingId: reaction.pendingId });
    finished = apply(
      finished,
      (action) => action.kind === "resolve_pending_triggered_effect"
    );
    for (let i = 0; finished.stackWindow && i < 5; i++) {
      finished = apply(
        finished,
        (action) => action.kind === "pass_stack",
        finished.stackWindow.priorityPlayerId
      );
    }
    expect(finished.players[0]!.countValue).toBe(11);
    expect(
      actions(finished).some(
        (action) => action.kind === "resolve_battle_immediate_effect"
      )
    ).toBe(true);
  });
  it("任意選択の前後でも同じ効果から派生するLv効果とドロー反応は同時発揮", () => {
    const { queued, resolve, apply } = setup("attack", true);
    const paused = resolve(queued, 0);
    expect(paused.pendingStepOptionalChoice).not.toBeNull();
    const child = paused.battleImmediateEffects.find(
      (prompt) => prompt.registrationIndex === 1
    )!;
    expect(child).toBeDefined();
    const resumed = apply(
      paused,
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "execute"
    );
    const drawReaction = resumed.pendingTriggeredEffects.find(
      (pending) => pending.eventKind === "increase_hand"
    );
    expect(drawReaction).toBeDefined();
    expect(drawReaction!.simultaneousGroupId).toBe(child.simultaneousGroupId);
  });
  it.each(["attack", "block"] as const)(
    "%s: Lv上昇で派生する本文はコア増加反応と同時、元の未解決本文より先",
    (timing) => {
      const { queued, owner, actions, resolve } = setup(timing);
      expect(
        queued.battleImmediateEffects.map((prompt) => prompt.registrationIndex)
      ).toEqual([0, 2]);
      const after = resolve(queued, 0);
      expect(
        after.cardInstances.find((card) => card.instanceId === "source")!
          .normalCoreCount
      ).toBe(2);
      const child = after.battleImmediateEffects.find(
        (prompt) => prompt.registrationIndex === 1
      )!;
      expect(child).toBeDefined();
      expect(child.causedByChainId).toContain("battle-immediate:");
      expect(child.simultaneousGroupId).not.toBe("declaration");
      expect(
        after.pendingTriggeredEffects.some(
          (pending) => pending.simultaneousGroupId === child.simultaneousGroupId
        )
      ).toBe(true);
      const available = actions(after);
      expect(
        available.some(
          (action) => action.kind === "resolve_pending_triggered_effect"
        )
      ).toBe(true);
      expect(
        available
          .filter((action) => action.kind === "resolve_battle_immediate_effect")
          .map((action) => action.promptId)
      ).toEqual([child.promptId]);
      const finished = resolve(after, 1);
      expect(
        finished.players.find((player) => player.id === owner)!.countValue
      ).toBe(1);
      expect(
        finished.battleImmediateEffects.map(
          (prompt) => prompt.registrationIndex
        )
      ).toEqual([2]);
    }
  );

  it.each(["attack", "block"] as const)(
    "%s: 条件を失って再達成しても同じ本文を再誘発しない",
    (timing) => {
      const { queued, lookups, owner, resolve } = setup(timing);
      const after = resolve(queued, 0);
      const lowered = moveNormalCores(
        after,
        { kind: "card", instanceId: "source" },
        { kind: "reserve", playerId: owner },
        1,
        lookups.getCardDefinitionById
      );
      const raised = moveNormalCores(
        lowered,
        { kind: "reserve", playerId: owner },
        { kind: "card", instanceId: "source" },
        1,
        lookups.getCardDefinitionById
      );
      const repeated = collectAndQueueTriggerReactions({
        beforeState: lowered,
        afterState: raised,
        source: "action_resolution",
        chainId: "same-timing",
        ...lookups,
      });
      expect(
        repeated.battleImmediateEffects.filter(
          (prompt) => prompt.registrationIndex === 1
        )
      ).toHaveLength(1);
    }
  );

  it.each([
    ["attack", "during"],
    ["attack", "after"],
    ["block", "during"],
    ["block", "after"],
  ] as const)(
    "%s: フラッシュ進行後（%s）のLv上昇では遡って誘発しない",
    (timing, phase) => {
      const { queued, lookups, owner } = setup(timing);
      const before: GameState = {
        ...queued,
        battleImmediateEffects: [],
        window:
          phase === "after"
            ? "declare_block"
            : timing === "attack"
              ? "flash_before_block"
              : "flash_after_block",
        activeAttack: {
          ...queued.activeAttack!,
          flashBeforeBlockCompleted: true,
          flashAfterBlockCompleted: timing === "block" && phase === "after",
        },
      };
      const after = moveNormalCores(
        before,
        { kind: "void", playerId: owner },
        { kind: "card", instanceId: "source" },
        1,
        lookups.getCardDefinitionById
      );
      const collected = collectAndQueueTriggerReactions({
        beforeState: before,
        afterState: after,
        source: "action_resolution",
        chainId: "flash-effect",
        ...lookups,
      });
      expect(collected.battleImmediateEffects).toEqual([]);
    }
  );
});
