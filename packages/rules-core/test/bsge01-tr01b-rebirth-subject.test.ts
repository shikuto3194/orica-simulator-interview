import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  getNextTrainingDecision,
  applyTrainingDecisionChoice,
  playTrainingGame,
  trainingProgressFingerprint,
  type Engine,
  type CardDefinition,
  type GameState,
  type PendingTriggeredEffect,
} from "../src";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import {
  getAvailableTriggeredEffectSourceChoices,
  collectAndQueueTriggerReactions,
  triggerEventKindToStructuredEvent,
} from "../src/effect/trigger-system";

import { queueRegisteredBattleImmediateEffects } from "../src/battle/battle-immediate-effect-system";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const getDef = (id: string) => definitions.find((d) => d.cardNo === id);
const lookups = {
  getCardDefinitionById: getDef,
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(definitions),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(definitions),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(definitions),
  getRegisteredBurstActions: () => [],
  getRegisteredMagicActions: buildMagicLookup(definitions),
};

const trainingEngine: Engine = {
  cards: definitions,
  getCardDefinitionById: getDef,
  lookups: {
    ...lookups,
    getRegisteredHandActivatedEffectActions: () => [],
    getRegisteredMagicActions: () => [],
  },
};

function makeState(hostNo = "BSGE01-CX01"): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 4 }, {}],
      cardInstances: [
        createCardInstance(getDef(hostNo)!, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
          attachedChildrenIds: ["brave"],
        }),
        createCardInstance(getDef("BSGE01-TR01(A)")!, {
          instanceId: "brave",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
          attachedToInstanceId: "host",
        }),
        ...["target-a", "target-b", "target-c"].map((instanceId) =>
          createCardInstance(getDef("BSTH01-C01")!, {
            instanceId,
            ownerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 1,
          })
        ),
      ],
    }),
    activePlayerId: "alice",
    turnNumber: 3,
    step: "main",
    window: "none",
  };
}

function actions(state: GameState, actingPlayerId = "alice") {
  return getLegalActions({ state, actingPlayerId, ...lookups });
}

function flip(state = makeState()): GameState {
  const declaration = actions(state).find(
    (a) =>
      a.kind === "use_field_card_effect" && a.sourceEffectInstanceId === "brave"
  );
  expect(declaration).toBeDefined();
  const declared = applyLegalAction({
    state,
    action: declaration!,
    ...lookups,
  }).state;
  const pass = actions(declared, "bob").find((a) => a.kind === "pass_stack");
  expect(pass).toBeDefined();
  return applyLegalAction({ state: declared, action: pass!, ...lookups }).state;
}

function flipDuringAfterBlockFlashWithNoCount(): GameState {
  const state = {
    ...makeState(),
    activePlayerId: "bob",
    step: "attack" as const,
    window: "flash_after_block" as const,
    players: makeState().players.map((player) =>
      player.id === "alice" ? { ...player, countValue: 0 } : player
    ),
    battleEntities: [
      {
        entityId: "battle-entity:host",
        memberInstanceIds: ["host", "brave"],
        resolvedBp: 10000,
        resolvedSymbols: ["red"],
        attackState: "attacking" as const,
      },
    ],
    activeAttack: {
      attackId: "attack-host",
      primaryEntityId: "battle-entity:host",
      participantEntityIds: ["battle-entity:host"],
      groupMode: "single" as const,
      target: { kind: "player" as const, playerId: "alice" },
      blockAssignments: [
        {
          participantEntityId: "battle-entity:host",
          blockedByEntityIds: ["battle-entity:host"],
        },
      ],
      symbolResolutionOrder: ["battle-entity:host"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "after_block" as const,
        priorityPlayerId: "alice",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        pendingStackAction: null,
      },
      attackAfterBurstChecked: true,
      ownAttackBurstChecked: true,
    },
  };
  const declaration = actions(state, "alice").find(
    (action) =>
      action.kind === "use_field_card_effect" &&
      action.sourceEffectInstanceId === "brave"
  );
  expect(declaration).toBeDefined();
  const declared = applyLegalAction({
    state,
    action: declaration!,
    ...lookups,
  }).state;
  const pass = actions(declared, "bob").find(
    (action) => action.kind === "pass_battle_flash"
  );
  expect(pass).toBeDefined();
  return applyLegalAction({ state: declared, action: pass!, ...lookups }).state;
}

function queueHostAttack(state: GameState): GameState {
  const sourceCard = state.cardInstances.find((c) => c.instanceId === "host")!;
  return queueRegisteredBattleImmediateEffects({
    state: {
      ...state,
      pendingTriggeredEffects: [],
      step: "attack",
      window: "declare_attack",
      battleEntities: [
        {
          entityId: "battle-entity:host",
          memberInstanceIds: ["host", "brave"],
          resolvedBp: 10000,
          resolvedSymbols: ["red", "red"],
          attackState: "attacking",
        },
      ],
    },
    attackId: "attack-host",
    participantEntityId: "battle-entity:host",
    actingPlayerId: "alice",
    sourceCard,
    sourceDefinition: getDef(sourceCard.definitionId)!,
    timing: "attack",
    ...lookups,
  });
}

function attackEffect(state: GameState) {
  return actions(queueHostAttack(state)).find(
    (a) =>
      a.kind === "resolve_battle_immediate_effect" &&
      a.sourceEffectInstanceId === "brave" &&
      !a.skipOnly
  );
}

function rebirthChoices(state: GameState, relatedInstanceId: string) {
  const pendingEffect: PendingTriggeredEffect = {
    pendingId: `rebirth:${relatedInstanceId}`,
    actingPlayerId: "alice",
    eventKind: "rebirth",
    event: triggerEventKindToStructuredEvent("rebirth"),
    source: "action_resolution",
    chainId: "test:bsge01-tr01b-rebirth-subject:210",
    attackId: null,
    relatedPlayerId: "alice",
    relatedInstanceId,
    amount: null,
    step: state.step,
    window: state.window,
    resolvedSourceInstanceIds: [],
  };
  return getAvailableTriggeredEffectSourceChoices({
    state,
    pendingEffect,
    ...lookups,
  }).filter(
    (choice) => choice.sourceEffectDefinition.cardNo === "BSGE01-TR01(B)"
  );
}

describe("BSGE01-TR01(B): 合体効果の発揮元と転醒イベントの主語", () => {
  it.each(["A", "B"])(
    "宣言時%s面: カウント条件の後達成は宣言時からB面だった場合だけ拾う",
    (face) => {
      // 同じ本文を条件未達から再評価するため、テスト専用のカウント条件を付ける。
      const gated: CardDefinition = {
        ...getDef("BSGE01-TR01(B)")!,
        effects: getDef("BSGE01-TR01(B)")!.effects!.map((effect) => ({
          ...effect,
          condition: [
            ...(effect.condition ?? []),
            { kind: "count_value", player: "self", min: 2 },
          ],
        })),
      };
      const gatedDefinitions = definitions.map((d) =>
        d.cardNo === gated.cardNo ? gated : d
      );
      const gatedLookups = {
        ...lookups,
        getCardDefinitionById: (id: string) =>
          gatedDefinitions.find((d) => d.cardNo === id),
        getRegisteredBattleImmediateEffectActions:
          buildBattleImmediateEffectLookup(gatedDefinitions),
      };
      const gatedActions = (current: GameState, actingPlayerId = "alice") =>
        getLegalActions({ state: current, actingPlayerId, ...gatedLookups });
      let state: GameState = {
        ...makeState(),
        step: "attack",
        players: makeState().players.map((p) => ({ ...p, countValue: 0 })),
        cardInstances: makeState().cardInstances.map((c) =>
          c.instanceId === "brave"
            ? { ...c, definitionId: `BSGE01-TR01(${face})` }
            : c
        ),
      };
      const attack = gatedActions(state).find((a) => a.kind === "attack")!;
      state = applyLegalAction({
        state,
        action: attack,
        ...gatedLookups,
      }).state;
      for (let i = 0; state.preDeclarationStackWindow && i < 5; i++) {
        const pass = gatedActions(
          state,
          state.preDeclarationStackWindow.priorityPlayerId
        ).find((a) => a.kind === "pass_pre_declaration_stack")!;
        state = applyLegalAction({
          state,
          action: pass,
          ...gatedLookups,
        }).state;
      }
      // 裏返し直後はカウント条件未達。その後、別効果でカウントを得るケース。
      const flipped: GameState = {
        ...state,
        battleImmediateEffects: [],
        cardInstances: state.cardInstances.map((c) =>
          c.instanceId === "brave"
            ? { ...c, definitionId: "BSGE01-TR01(B)" }
            : c
        ),
      };
      const raised = collectAndQueueTriggerReactions({
        beforeState: flipped,
        afterState: {
          ...flipped,
          players: flipped.players.map((p) => ({ ...p, countValue: 4 })),
        },
        source: "action_resolution",
        chainId: "later-count-gain",
        ...gatedLookups,
      });
      expect(raised.battleImmediateEffects).toHaveLength(face === "B" ? 1 : 0);
    }
  );

  it("A面のアタック時で裏返したB面は転醒時だけ発揮し、2体破壊後もアタック時を追加しない", () => {
    let state: GameState = { ...makeState(), step: "attack" };
    const apply = (kind: string, extra = {}) => {
      const player =
        state.stackWindow?.priorityPlayerId ??
        state.preDeclarationStackWindow?.priorityPlayerId ??
        "alice";
      const action = actions(state, player).find((a) => a.kind === kind);
      expect(action, JSON.stringify(actions(state, player))).toBeDefined();
      state = applyLegalAction({
        state,
        action: action!,
        ...extra,
        ...lookups,
      }).state;
    };
    const pass = () => {
      for (
        let i = 0;
        i < 8 && (state.stackWindow || state.preDeclarationStackWindow);
        i++
      )
        apply(
          state.preDeclarationStackWindow
            ? "pass_pre_declaration_stack"
            : "pass_stack"
        );
    };
    apply("attack");
    pass();
    expect(state.battleImmediateEffects).toHaveLength(1);
    apply("resolve_battle_immediate_effect");
    pass();
    expect(state.pendingStepOptionalChoice).not.toBeNull();
    const execute = actions(state).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(execute).toBeDefined();
    state = applyLegalAction({ state, action: execute!, ...lookups }).state;
    expect(
      state.cardInstances.find((c) => c.instanceId === "brave")?.definitionId
    ).toBe("BSGE01-TR01(B)");
    expect(state.players[0]!.countValue).toBe(6);
    expect(state.battleImmediateEffects).toEqual([]);
    expect(
      state.pendingTriggeredEffects.filter((p) => p.eventKind === "rebirth")
    ).toHaveLength(1);
    apply("resolve_pending_triggered_effect", {
      targetInstanceIds: ["target-a", "target-b"],
    });
    pass();
    expect(state.players[0]!.countValue).toBe(4);
    expect(
      state.cardInstances
        .filter((c) => ["target-a", "target-b"].includes(c.instanceId))
        .map((c) => c.zone)
    ).toEqual(["trash", "trash"]);
    expect(state.battleImmediateEffects).toEqual([]);
    expect(state.pendingTriggeredEffects).toEqual([]);
  });

  it("後半フラッシュ中にカウント不足で転醒した任意効果も、training surface が drain action を提示する", () => {
    const flipped = flipDuringAfterBlockFlashWithNoCount();
    expect(
      flipped.players.find((player) => player.id === "alice")?.countValue
    ).toBe(0);
    expect(flipped.pendingTriggeredEffects).toHaveLength(1);
    const node = getNextTrainingDecision(flipped, trainingEngine, {
      maxGeneratedChoices: 128,
    });
    expect(node?.actingPlayerId).toBe("alice");
    expect(
      node?.choices.some(
        (choice) => choice.action?.kind === "resolve_pending_triggered_effect"
      )
    ).toBe(true);
    const resolve = node?.choices.find(
      (choice) => choice.action?.kind === "resolve_pending_triggered_effect"
    );
    expect(resolve).toBeDefined();
    expect(resolve?.action).toMatchObject({ skipOnly: true });
    const declared = applyTrainingDecisionChoice(
      flipped,
      node!,
      resolve!,
      trainingEngine
    );
    expect(declared.pendingTriggeredEffects).toHaveLength(0);
    const replay = playTrainingGame({
      initialState: flipped,
      engine: trainingEngine,
      maxForcedTransitions: 1,
      initialProgressStateVisits: new Map([
        [trainingProgressFingerprint(declared), 1],
      ]),
    });
    expect(replay.trace[0]?.choiceId).toBe(resolve?.choiceId);
    expect(replay.terminationReason).toBe("forced_transition_limit");
  });

  it("実際のフラッシュ裏返しから、hostを発揮元とするB面転醒時効果で2体破壊する", () => {
    const flipped = flip();
    expect(
      flipped.cardInstances.find((c) => c.instanceId === "brave")?.definitionId
    ).toBe("BSGE01-TR01(B)");
    expect(flipped.players[0]?.countValue).toBe(4);
    expect(
      flipped.pendingTriggeredEffects.some(
        (p) => p.eventKind === "rebirth" && p.relatedInstanceId === "brave"
      )
    ).toBe(true);
    const trigger = actions(flipped).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "host" &&
        a.sourceEffectInstanceId === "brave"
    );
    expect(trigger).toBeDefined();
    const declared = applyLegalAction({
      state: flipped,
      action: trigger!,
      targetInstanceIds: ["target-a", "target-b"],
      ...lookups,
    }).state;
    const pass = actions(declared, "bob").find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();
    const resolved = applyLegalAction({
      state: declared,
      action: pass!,
      ...lookups,
    }).state;
    expect(resolved.players[0]?.countValue).toBe(2);
    expect(
      resolved.cardInstances
        .filter((c) => ["target-a", "target-b"].includes(c.instanceId))
        .map((c) => c.zone)
    ).toEqual(["trash", "trash"]);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "target-c")?.zone
    ).toBe("field");
    // カウント2と対象1体が残っていても、転醒時に使った同じ効果を再使用できない。
    expect(attackEffect(resolved)).toBeUndefined();
  });

  it("転醒時に未使用なら、hostのアタック時にも発揮できる", () => {
    expect(attackEffect(flip())).toMatchObject({
      sourceInstanceId: "host",
      sourceEffectInstanceId: "brave",
      sourceCardNo: "BSGE01-TR01(B)",
    });
  });

  it("合体していないB面は自身が転醒しても合体中効果を発揮しない", () => {
    const state = flip();
    const detached = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === "brave"
          ? { ...c, attachedToInstanceId: null }
          : c.instanceId === "host"
            ? { ...c, attachedChildrenIds: [] }
            : c
      ),
    };
    expect(rebirthChoices(detached, "brave")).toHaveLength(0);
  });

  it("hostや別カードの転醒を拾わず、自身の転醒だけを拾う", () => {
    const state = flip();
    expect(rebirthChoices(state, "brave")).toHaveLength(1);
    expect(rebirthChoices(state, "host")).toHaveLength(0);
    expect(rebirthChoices(state, "target-a")).toHaveLength(0);
  });
});

describe("合体効果へのスタックで合体先が離脱する", () => {
  it.each(["keep", "send_with_host"] as const)(
    "%s の選択・離脱確定後に合体中効果を不発にする",
    (choice) => {
      let state = flip(
        rebuildContinuousEffectsFromField(makeState("BSGE01-R01"), getDef)
      );
      state = {
        ...state,
        step: "attack",
        window: "none",
        players: state.players.map((p) => ({
          ...p,
          reserveNormalCoreCount: 6,
        })),
        cardInstances: [
          ...state.cardInstances,
          createCardInstance(getDef("BSTH08-C01")!, {
            instanceId: "response",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
        ],
      };
      const act = (kind: string, player = "alice", selectedChoice?: string) => {
        const action = actions(state, player).find(
          (a) =>
            a.kind === kind &&
            (selectedChoice === undefined ||
              ("choice" in a && a.choice === selectedChoice)) &&
            (kind !== "use_magic" || ("timing" in a && a.timing === "stack"))
        );
        expect(action, JSON.stringify(actions(state, player))).toBeDefined();
        state = applyLegalAction({
          state,
          action: action!,
          ...(action?.kind === "use_magic"
            ? {
                paymentSources: [
                  { kind: "reserve" as const, amount: action.finalCost },
                ],
              }
            : {}),
          ...lookups,
        }).state;
      };
      act("resolve_pending_triggered_effect");
      expect(
        state.effectUsageRecords.some(
          (r) => r.effectLabel === "effect:2" && r.count > 0
        )
      ).toBe(true);
      act("use_magic", "bob");
      act("pass_stack");
      expect(state.pendingEffectTargetSelection?.sourceInstanceId).toBe(
        "response"
      );
      const target = actions(state, "bob").find(
        (a) => a.kind === "resolve_pending_effect_target"
      );
      expect(target, JSON.stringify(actions(state, "bob"))).toBeDefined();
      state = applyLegalAction({
        state,
        action: target!,
        targetInstanceIds: ["host"],
        ...lookups,
      }).state;
      expect(state.pendingBraveLeaveChoice).not.toBeNull();
      expect(state.pendingEffectTargetSelection).toBeNull();
      act("resolve_brave_leave_choice", "alice", choice);
      if (state.pendingSoulStateReplacement)
        act("resolve_soul_state_replacement", "alice", "decline");
      expect(state.pendingEffectTargetSelection).toBeNull();
      expect(state.pendingStackCascade).toBeNull();
      expect(state.pendingLeaveEntities).toEqual([]);
      // 04:141-142: スタック側の内側チェーンを実移動まで閉じてから元効果へ戻る。
      const movedAt = state.log.findIndex((line) =>
        line.startsWith("pending-leave-flushed:bounce:host:")
      );
      const fizzledAt = state.log.findIndex((line) =>
        line.includes("effect-source-not-star-garment-under")
      );
      expect(movedAt).toBeGreaterThanOrEqual(0);
      expect(fizzledAt).toBeGreaterThan(movedAt);
      expect(
        state.cardInstances.find((c) => c.instanceId === "host")?.zone
      ).toBe("hand");
      expect(
        state.cardInstances.find((c) => c.instanceId === "brave")?.zone
      ).toBe(choice === "keep" ? "field" : "hand");
      expect(
        state.cardInstances
          .filter((c) => c.instanceId.startsWith("target-"))
          .every((c) => c.zone === "field")
      ).toBe(true);
      expect(state.players[0]?.countValue).toBe(4);
      expect(
        state.effectUsageRecords.some(
          (r) =>
            r.effectLabel === "effect:2" &&
            ["host", "brave"].includes(r.sourceInstanceId) &&
            r.count > 0
        )
      ).toBe(false);
    }
  );
});
