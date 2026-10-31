/**
 * ENGINE-grant-effect-pre-flush-window (2026-07-02, engine-claude lane)
 *
 * grant_effect で付与された「相手によってフィールドを離れるとき、〜で残せる」型の反応
 * (BSFT01-TR05(A) 等) が、物理 flush より前に解決窓を確保できることを検証する。
 *
 * 3層の検証:
 *  1. grant-effect-system.ts: `timing.event:"leave_field"` 宣言が pre-flush destroy/vanish/
 *     bounce/remove_from_game イベントに一致する (leave_field umbrella, trigger-system.ts と SSOT 共有) こと、
 *     および queueGrantedEffectTriggersFromTriggerEvents が mechanic pending に発火元
 *     イベントの chainId を継承させること。
 *  2. state-based-actions.ts: 離脱者自身への未解決 granted_effect mechanic pending がある間、
 *     canFlushPendingLeaveEntity (経由の flushPendingLeaves) が defer フラグを問わず
 *     物理移動を保留すること (`hasPendingGrantedEffectLeaveReactionForLeaver`)。
 *  3. legal-actions-apply.ts: 反応を辞退 (decline) した場合でも、辞退後に flush が
 *     やり直され、待機が stranded しないこと。
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { queueGrantedEffectTriggersFromTriggerEvents } from "../src/mechanics/grant-effect-system";
import { flushPendingLeaves } from "../src/state-based-actions";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import type { Effect } from "../src/dsl-types";
import type {
  CardDefinition,
  GameState,
  PendingLeaveEntity,
} from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

function spiritDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `テスト ${cardNo}`,
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 4,
    cost: 4,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    textLines: [],
    images: {},
    tribe: "テスト種族",
    colors: ["red"],
  } as CardDefinition;
}

const SOURCE_DEF = spiritDef("GRANT-LEAVE-SOURCE");
const TARGET_DEF = spiritDef("GRANT-LEAVE-TARGET");
const DESTROYER_DEF: CardDefinition = {
  ...spiritDef("GRANT-LEAVE-DESTROYER"),
  effects: [
    {
      timing: { kind: "card_event", event: "summon" },
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
} as CardDefinition;
const DEFS: Record<string, CardDefinition> = {
  "GRANT-LEAVE-SOURCE": SOURCE_DEF,
  "GRANT-LEAVE-TARGET": TARGET_DEF,
  "GRANT-LEAVE-DESTROYER": DESTROYER_DEF,
};
const getDef = (id: string): CardDefinition | undefined => DEFS[id];
const triggeredLookup = buildTriggeredEffectLookup([
  SOURCE_DEF,
  TARGET_DEF,
  DESTROYER_DEF,
]);

/** BSLH01-R01 / BSFT01-TR05(A) 型: 相手によって離れるとき、ボイドコア1個で残せる。 */
const STAY_ON_FIELD_GRANTED_EFFECT: Effect = {
  timing: { kind: "card_event", event: "leave_field" },
  executionMode: "optional",
  steps: [
    {
      action: {
        kind: "core_move",
        from: { kind: "void", player: "self" },
        to: { kind: "this_card" },
        amount: 1,
      },
    },
    {
      action: { kind: "stay_on_field", target: { kind: "self" } },
      connector: "conditional_cost",
    },
  ],
} as unknown as Effect;

const REMOVE_FROM_GAME_STAY_ON_FIELD_GRANTED_EFFECT: Effect = {
  ...STAY_ON_FIELD_GRANTED_EFFECT,
  timing: { kind: "card_event", event: "remove_from_game" },
} as unknown as Effect;

const GRANT_ACTION: Effect = {
  timing: { kind: "activated", mode: "flash" },
  steps: [
    {
      action: {
        kind: "grant_effect",
        target: {
          kind: "filter",
          player: "self",
          count: "all",
          filter: { category: ["spirit"] },
        },
        grantedEffect: STAY_ON_FIELD_GRANTED_EFFECT,
      },
    },
  ],
} as unknown as Effect;

function registeredState(): GameState {
  const source = createCardInstance(SOURCE_DEF, {
    instanceId: "source-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const target = createCardInstance(TARGET_DEF, {
    instanceId: "target-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const state: GameState = {
    ...base,
    activePlayerId: ALICE,
    cardInstances: [source, target],
    activeContinuousEffects: [],
  };
  return executeEffect({
    chainId: "test:grant-effect-leave-field-pre-flush:152",
    state,
    effect: GRANT_ACTION,
    sourceInstanceId: "source-1",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
  });
}

function destroyPendingLeave(chainId: string): PendingLeaveEntity {
  return {
    instanceId: "target-1",
    kind: "destroy",
    cause: "effect_resolution",
    causePlayerId: BOB,
    chainId,
    deferZoneMoveUntilChainEnd: false,
    leaveFieldCoreDestinationOverride: null,
  };
}

function removeFromGamePendingLeave(chainId: string): PendingLeaveEntity {
  return {
    instanceId: "target-1",
    kind: "remove_from_game",
    cause: "effect_resolution",
    causePlayerId: BOB,
    chainId,
    deferZoneMoveUntilChainEnd: false,
    leaveFieldCoreDestinationOverride: null,
  };
}

/**
 * `state.pendingLeaveEntities` に加え、対応する CardInstance 側の pendingLeave* フィールドも
 * 同期させる (flushPendingLeaves は両方が揃って初めて対象を実移動できる)。
 */
function withDestroyPending(state: GameState, chainId: string): GameState {
  return {
    ...state,
    effectQueueEntries: [],
    pendingLeaveEntities: [destroyPendingLeave(chainId)],
    cardInstances: state.cardInstances.map((c) =>
      c.instanceId === "target-1"
        ? {
            ...c,
            pendingLeaveKind: "destroy" as const,
            pendingLeaveCause: "effect_resolution" as const,
            pendingLeaveChainId: chainId,
          }
        : c
    ),
  };
}

function withRemoveFromGamePending(
  state: GameState,
  chainId: string
): GameState {
  return {
    ...state,
    effectQueueEntries: [],
    pendingLeaveEntities: [removeFromGamePendingLeave(chainId)],
    cardInstances: state.cardInstances.map((c) =>
      c.instanceId === "target-1"
        ? {
            ...c,
            pendingLeaveKind: "remove_from_game" as const,
            pendingLeaveCause: "effect_resolution" as const,
            pendingLeaveChainId: chainId,
          }
        : c
    ),
  };
}

function destroyEvent(chainId: string) {
  return {
    eventKind: "destroy",
    relatedInstanceId: "target-1",
    relatedPlayerId: ALICE,
    chainId,
  };
}

function passStackUntilClosed(state: GameState): GameState {
  let current = state;
  for (let i = 0; i < 10 && current.stackWindow !== null; i++) {
    const actingPlayerId = current.stackWindow.priorityPlayerId;
    const pass = getLegalActions({
      state: current,
      actingPlayerId,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => [],
    }).find((a) => a.kind === "pass_stack");
    expect(pass, `pass_stack for ${actingPlayerId}`).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: pass!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
  }
  return current;
}

describe("ENGINE-grant-effect-pre-flush-window: leave_field umbrella 検出 + chainId 継承", () => {
  it("field remove_from_game pending leave は conditional_result の成功として扱う", () => {
    const drawDef = spiritDef("DRAW-CARD");
    const source = createCardInstance(DESTROYER_DEF, {
      instanceId: "source-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(TARGET_DEF, {
      instanceId: "target-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const deckCard = createCardInstance(drawDef, {
      instanceId: "draw-1",
      ownerPlayerId: BOB,
      zone: "deck",
      normalCoreCount: 0,
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "remove",
          action: {
            kind: "remove_from_game",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
          },
        },
        {
          connector: "conditional_result",
          action: { kind: "draw", count: 1 },
        },
      ],
    } as unknown as Effect;

    const next = executeEffect({
      chainId: "test:grant-effect-leave-field-pre-flush:303",
      state: {
        ...base,
        activePlayerId: BOB,
        cardInstances: [source, target, deckCard],
      },
      effect,
      sourceInstanceId: "source-1",
      actingPlayerId: BOB,
      targetInstanceIds: ["target-1"],
      getCardDefinitionById: (id) =>
        id === DESTROYER_DEF.cardNo
          ? DESTROYER_DEF
          : id === TARGET_DEF.cardNo
            ? TARGET_DEF
            : id === drawDef.cardNo
              ? drawDef
              : undefined,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(next.pendingLeaveEntities).toHaveLength(1);
    expect(next.pendingLeaveEntities[0]).toMatchObject({
      instanceId: "target-1",
      kind: "remove_from_game",
    });
    expect(
      next.cardInstances.find((c) => c.instanceId === "draw-1")?.zone
    ).toBe("hand");
  });

  it("remove_from_game は card_event DSL として登録できる", () => {
    const def: CardDefinition = {
      ...spiritDef("REMOVE-FROM-GAME-LISTENER"),
      effects: [
        {
          timing: { kind: "card_event", event: "remove_from_game" },
          steps: [
            {
              action: {
                kind: "draw",
                player: "self",
                count: 1,
              },
            },
          ],
        },
      ],
    } as CardDefinition;
    const lookup = buildTriggeredEffectLookup([def]);
    const registrations = lookup(def.cardNo);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.eventKind).toBe("remove_from_game");
  });

  it("timing.event:'leave_field' 宣言は pre-flush destroy イベントに一致し mechanic pending を積む", () => {
    const state = registeredState();
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [destroyEvent("chain-x")],
      getDef
    );
    const pendings = next.pendingTriggeredEffects.filter(
      (p) => p.mechanic?.kind === "granted_effect"
    );
    expect(pendings).toHaveLength(1);
    expect(pendings[0]!.relatedInstanceId).toBe("target-1");
    // 発火元イベントの chainId を継承する（flush ゲートが検出できるようにするため）。
    expect(pendings[0]!.chainId).toBe("chain-x");
  });

  it("vanish / bounce / remove_from_game イベントにも同様に一致する (umbrella の全種別カバー)", () => {
    const state = registeredState();
    for (const eventKind of ["vanish", "bounce", "remove_from_game"] as const) {
      const next = queueGrantedEffectTriggersFromTriggerEvents(
        state,
        [
          {
            eventKind,
            relatedInstanceId: "target-1",
            relatedPlayerId: ALICE,
            chainId: "chain-y",
          },
        ],
        getDef
      );
      const pendings = next.pendingTriggeredEffects.filter(
        (p) => p.mechanic?.kind === "granted_effect"
      );
      expect(pendings, eventKind).toHaveLength(1);
    }
  });

  it("無関係な eventKind (summon 等) には一致しない", () => {
    const state = registeredState();
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          eventKind: "summon",
          relatedInstanceId: "target-1",
          relatedPlayerId: ALICE,
          chainId: "chain-z",
        },
      ],
      getDef
    );
    expect(
      next.pendingTriggeredEffects.filter(
        (p) => p.mechanic?.kind === "granted_effect"
      )
    ).toHaveLength(0);
  });
});

describe("ENGINE-grant-effect-pre-flush-window: flush ゲート (defer=false でも保留)", () => {
  it("離脱者自身への granted_effect mechanic pending が未解決の間、物理 flush を保留する", () => {
    const state = registeredState();
    const chainId = "chain-coreshoot";
    const withPendingLeave = withDestroyPending(state, chainId);
    const withGrantedPending = queueGrantedEffectTriggersFromTriggerEvents(
      withPendingLeave,
      [destroyEvent(chainId)],
      getDef
    );
    expect(
      withGrantedPending.pendingTriggeredEffects.some(
        (p) => p.mechanic?.kind === "granted_effect"
      )
    ).toBe(true);

    const flushed = flushPendingLeaves(withGrantedPending, getDef);
    const target = flushed.cardInstances.find(
      (c) => c.instanceId === "target-1"
    );
    // pending 未解決の間は実移動しない。
    expect(target?.zone).toBe("field");
    expect(flushed.pendingLeaveEntities).toHaveLength(1);
  });

  it("event:'remove_from_game' の granted stay_on_field pending も flush 前に保留する", () => {
    const state = registeredState();
    const grantCe = state.activeContinuousEffects.find(
      (ce) => ce.metadata?.grantedEffect === STAY_ON_FIELD_GRANTED_EFFECT
    );
    expect(grantCe).toBeDefined();
    const chainId = "chain-rfg-gate";
    const withPendingLeave = withRemoveFromGamePending(
      {
        ...state,
        activeContinuousEffects: state.activeContinuousEffects.map((ce) =>
          ce.effectId === grantCe!.effectId
            ? {
                ...ce,
                metadata: {
                  ...ce.metadata,
                  grantedEffect: REMOVE_FROM_GAME_STAY_ON_FIELD_GRANTED_EFFECT,
                },
              }
            : ce
        ),
      },
      chainId
    );
    const withGrantedPending = queueGrantedEffectTriggersFromTriggerEvents(
      withPendingLeave,
      [
        {
          eventKind: "remove_from_game",
          relatedInstanceId: "target-1",
          relatedPlayerId: ALICE,
          chainId,
        },
      ],
      getDef
    );

    const flushed = flushPendingLeaves(withGrantedPending, getDef);
    const target = flushed.cardInstances.find(
      (c) => c.instanceId === "target-1"
    );
    expect(
      flushed.pendingTriggeredEffects.some(
        (p) => p.mechanic?.kind === "granted_effect"
      )
    ).toBe(true);
    expect(target?.zone).toBe("field");
    expect(flushed.pendingLeaveEntities).toHaveLength(1);
  });

  it("granted_effect mechanic pending 解消後は通常どおり flush される", () => {
    const state = registeredState();
    const chainId = "chain-coreshoot-2";
    const withPendingLeave = withDestroyPending(state, chainId);
    // pending 無し (辞退/受諾済みを模す) → 通常の flush ゲートに戻る。
    const flushed = flushPendingLeaves(withPendingLeave, getDef);
    const target = flushed.cardInstances.find(
      (c) => c.instanceId === "target-1"
    );
    expect(target?.zone).toBe("trash");
  });
});

describe("ENGINE-grant-effect-pre-flush-window: 辞退時に待機が stranded しない", () => {
  it("残置選択を辞退すると、辞退直後の legal action 適用内で flush され trash へ移動する", () => {
    const state = registeredState();
    const chainId = "chain-decline";
    const withPendingLeave = withDestroyPending(state, chainId);
    const withGrantedPending = queueGrantedEffectTriggersFromTriggerEvents(
      withPendingLeave,
      [destroyEvent(chainId)],
      getDef
    );
    const pendingId = withGrantedPending.pendingTriggeredEffects.find(
      (p) => p.mechanic?.kind === "granted_effect"
    )!.pendingId;

    const action = getLegalActions({
      state: withGrantedPending,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === pendingId
    );
    expect(action).toBeDefined();

    const declined = applyLegalAction({
      state: withGrantedPending,
      action: action!,
      skipOptionalEffect: true,
      getCardDefinitionById: getDef,
    }).state;

    expect(
      declined.pendingTriggeredEffects.some(
        (p) => p.mechanic?.kind === "granted_effect"
      )
    ).toBe(false);
    // 辞退の skip 経路は finalize/flush を通らないため、applyLegalAction 側の
    // 再 flush フックが無いと待機が stranded する（回帰ガード）。
    const target = declined.cardInstances.find(
      (c) => c.instanceId === "target-1"
    );
    expect(target?.zone).toBe("trash");
    expect(declined.pendingLeaveEntities).toHaveLength(0);
  });

  it("EDH-0001: バトル中の魂状態 keep は即時 battle-end と attack-step finalization を同じ action で drain する", () => {
    const state = registeredState();
    const pendingBattleEndState: GameState = {
      ...withDestroyPending(
        state,
        "battle-resolution:21:player-1:attack:soul-state"
      ),
      turnNumber: 21,
      activePlayerId: ALICE,
      step: "attack",
      window: "none",
      activeAttack: null,
      pendingSoulStateReplacement: {
        choosingPlayerId: ALICE,
        cardInstanceId: "target-1",
        originalLeaveKind: "destroy",
        originalLeaveCause: "battle",
      },
      pendingImmediateBattleEnds: [
        {
          attackId: "attack:edh-0001-soul-state",
          participantInstanceIds: ["target-1"],
          blockSideInstanceIds: [],
          participantSnapshots: [],
          appliedLifeDamage: 0,
        },
      ],
      pendingAttackStepEndFinalizations: [
        {
          pendingId: "attack-step-end:21:0",
          actingPlayerId: ALICE,
          sourceInstanceId: ALICE,
          createdAtTurn: 21,
        },
      ],
    };
    const keep = getLegalActions({
      state: pendingBattleEndState,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find(
      (action) =>
        action.kind === "resolve_soul_state_replacement" &&
        action.choice === "keep"
    );
    expect(keep).toBeDefined();

    const resolved = applyLegalAction({
      state: pendingBattleEndState,
      action: keep!,
      getCardDefinitionById: getDef,
    }).state;

    expect(resolved.pendingSoulStateReplacement).toBeNull();
    expect(resolved.pendingImmediateBattleEnds).toEqual([]);
    expect(resolved.pendingAttackStepEndFinalizations).toEqual([]);
    expect(resolved.step).toBe("end");
    expect(resolved.log).toContain("effect:end_attack_step:finalized:player-1");
  });

  it("EDH-0001: battle-end 中の付与誘発を辞退すると終了予約と entry を同時に drain する", () => {
    const state = registeredState();
    const chainId = "battle-resolution:17:player-1:attack:edh-0001";
    const withGrantedPending = queueGrantedEffectTriggersFromTriggerEvents(
      withDestroyPending(state, chainId),
      [destroyEvent(chainId)],
      getDef
    );
    const pendingId = withGrantedPending.pendingTriggeredEffects.find(
      (pending) => pending.mechanic?.kind === "granted_effect"
    )!.pendingId;
    const pendingBattleEndState: GameState = {
      ...withGrantedPending,
      turnNumber: 17,
      activePlayerId: ALICE,
      step: "attack",
      window: "none",
      activeAttack: null,
      pendingImmediateBattleEnds: [
        {
          attackId: "attack:edh-0001",
          participantInstanceIds: [],
          blockSideInstanceIds: [],
          participantSnapshots: [],
          appliedLifeDamage: 0,
        },
      ],
      pendingAttackStepEndFinalizations: [
        {
          pendingId: "attack-step-end:17:0",
          actingPlayerId: ALICE,
          sourceInstanceId: ALICE,
          createdAtTurn: 17,
        },
      ],
    };
    const action = getLegalActions({
      state: pendingBattleEndState,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_triggered_effect" &&
        candidate.pendingId === pendingId
    );
    expect(action).toBeDefined();

    const declined = applyLegalAction({
      state: pendingBattleEndState,
      action: action!,
      skipOptionalEffect: true,
      getCardDefinitionById: getDef,
    }).state;

    expect(declined.pendingTriggeredEffects).toHaveLength(0);
    expect(declined.pendingLeaveEntities).toHaveLength(0);
    expect(declined.pendingImmediateBattleEnds).toHaveLength(0);
    expect(declined.pendingAttackStepEndFinalizations).toHaveLength(0);
    expect(declined.step).toBe("end");
    expect(declined.log).toContain("effect:end_attack_step:finalized:player-1");
  });
});

describe("ENGINE-grant-effect-pre-flush-window: effect-resolution finalize 経路", () => {
  it("通常の誘発解決で発生した leave_field は flush 前に granted_effect pending を積む", () => {
    const granted = registeredState();
    const destroyer = createCardInstance(DESTROYER_DEF, {
      instanceId: "destroyer-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...granted,
      activePlayerId: BOB,
      cardInstances: [...granted.cardInstances, destroyer],
      pendingTriggeredEffects: [
        {
          pendingId: "prod-destroy-pending",
          eventKind: "summon",
          actingPlayerId: BOB,
          source: "action_resolution",
          chainId: "prod-destroy-chain",
          attackId: null,
          relatedPlayerId: BOB,
          relatedInstanceId: "destroyer-1",
          amount: null,
          step: "main",
          window: "default",
          resolvedSourceInstanceIds: [],
        },
      ],
    };
    const declaration = getLegalActions({
      state,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === "prod-destroy-pending" &&
        a.sourceInstanceId === "destroyer-1"
    );
    expect(declaration).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: declaration!,
      targetInstanceIds: ["target-1"],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    const afterDestroyResolution = passStackUntilClosed(declared);

    const targetAfterDestroy = afterDestroyResolution.cardInstances.find(
      (c) => c.instanceId === "target-1"
    )!;
    expect(targetAfterDestroy.zone).toBe("field");
    expect(targetAfterDestroy.pendingLeaveKind).toBe("destroy");
    const grantedPendings =
      afterDestroyResolution.pendingTriggeredEffects.filter(
        (p) =>
          p.mechanic?.kind === "granted_effect" &&
          p.relatedInstanceId === "target-1"
      );
    expect(grantedPendings).toHaveLength(1);
    const grantedPending = grantedPendings[0];
    expect(grantedPending).toBeDefined();
  });
});
