import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  executeEndAttackStep,
  executeEndTurn,
  finalizePendingAttackStepEndFinalizations,
  finalizePendingTurnEndFinalizations,
  applyLegalAction,
  advanceStep,
} from "../src/index";
import { executeEndSingleBattle } from "../src/battle/battle-actions";
import { executeEndBattle } from "../src/effect/structured-effect-interpreter";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";
import type {
  ActiveAttack,
  CardDefinition,
  GameState,
  Effect,
} from "../src/index";

/**
 * 「相手は効果でアタックステップを終了できない」(restrict_end_attack_step) と
 * R12「この効果は…受けない」(unaffectedByRestriction) の2層。
 *
 * ルール解釈 (ユーザー裁定 2026-05-31): 「終了できない」は「終了する」効果を妨害し、
 * 「終了する」側は効果を受ける。「『終了できない』を受けない」はその妨害からの防御
 * (効果耐性) であり、攻撃側の貫通 (preventionLevel:unpreventable) ではない。
 */
describe("restrict_end_attack_step — 効果でアタックステップ終了を妨害 / R12 は受けない", () => {
  const restrictDef = {
    cardNo: "RESTRICT-001",
    name: "RESTRICT-001",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: ["相手は効果でアタックステップを終了できない。"],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;

  const restrictEffect: Effect = {
    timing: { kind: "continuous" },
    steps: [
      {
        action: {
          kind: "restrict_end_attack_step",
          player: "opponent",
          duration: { scope: "while_on_field" },
        },
      },
    ],
  };

  const triggeredLookup = buildTriggeredEffectLookup([restrictDef]);
  const getCardDefinitionById = (id: string) =>
    id === restrictDef.cardNo ? restrictDef : undefined;

  /** bob が restrict ネクサスを場に出した状態 (CE は alice を制限)。step=attack, alice ターン。 */
  function buildRestrictedState(): GameState {
    const bobNexus = createCardInstance(restrictDef, {
      instanceId: "bob-nexus-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [bobNexus],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "attack",
      window: "none",
    };
    // bob の継続効果を登録 → CE が alice を制限。
    state = executeEffect({
      chainId: "test:restrict-end-attack-step:85",
      state,
      effect: restrictEffect,
      sourceInstanceId: "bob-nexus-1",
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      effectIndex: 0,
    });
    return state;
  }

  it("制限 CE が制限対象 (alice) を正しく登録する", () => {
    const state = buildRestrictedState();
    const ce = state.activeContinuousEffects.find(
      (c) => c.modifierTag === "restrict_end_attack_step"
    );
    expect(ce).toBeDefined();
    expect(ce!.targetInstanceId).toBe("alice");
  });

  it("alice の効果由来 end_attack_step は妨害され no-op (受ける)", () => {
    const state = buildRestrictedState();
    const after = executeEndAttackStep(state, "alice");
    expect(after.step).toBe("attack");
  });

  it("R12「受けない」(unaffectedByRestriction) は妨害を受けず終了する", () => {
    const state = buildRestrictedState();
    const queued = executeEndAttackStep(state, "alice", true);
    expect(queued.pendingAttackStepEndFinalizations).toHaveLength(1);
    const after = finalizePendingAttackStepEndFinalizations(queued);
    expect(after.step).toBe("end");
  });

  it("制限対象でないプレイヤー (bob) の終了は妨害されない", () => {
    const state = buildRestrictedState();
    const queued = executeEndAttackStep(state, "bob");
    expect(queued.pendingAttackStepEndFinalizations).toHaveLength(1);
    const after = finalizePendingAttackStepEndFinalizations(queued);
    expect(after.step).toBe("end");
  });

  it("制限が無ければ通常どおり終了する", () => {
    const base = buildRestrictedState();
    const noRestrict: GameState = {
      ...base,
      activeContinuousEffects: base.activeContinuousEffects.filter(
        (c) => c.modifierTag !== "restrict_end_attack_step"
      ),
    };
    const queued = executeEndAttackStep(noRestrict, "alice");
    expect(queued.pendingAttackStepEndFinalizations).toHaveLength(1);
    const after = finalizePendingAttackStepEndFinalizations(queued);
    expect(after.step).toBe("end");
  });
});

describe("restrict_end_turn — 効果でターン終了を妨害 / R12 は受けない", () => {
  const restrictDef = {
    cardNo: "RESTRICT-TURN-001",
    name: "RESTRICT-TURN-001",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: ["相手は効果でターンを終了できない。"],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;

  const restrictEffect: Effect = {
    timing: { kind: "continuous" },
    timingScope: { player: "self", period: "attack" },
    steps: [
      {
        action: {
          kind: "restrict_end_turn",
          player: "opponent",
          duration: { scope: "while_on_field" },
        },
      },
    ],
  };

  const triggeredLookup = buildTriggeredEffectLookup([restrictDef]);
  const getCardDefinitionById = (id: string) =>
    id === restrictDef.cardNo ? restrictDef : undefined;

  function buildRestrictedState(): GameState {
    const bobNexus = createCardInstance(restrictDef, {
      instanceId: "bob-turn-nexus-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [bobNexus],
      }),
      turnNumber: 2,
      activePlayerId: "bob",
      step: "attack",
      window: "none",
    };
    state = executeEffect({
      chainId: "test:restrict-end-attack-step:194",
      state,
      effect: restrictEffect,
      sourceInstanceId: "bob-turn-nexus-1",
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      effectIndex: 0,
    });
    return state;
  }

  it("制限 CE が制限対象 (alice) を正しく登録する", () => {
    const state = buildRestrictedState();
    const ce = state.activeContinuousEffects.find(
      (c) => c.modifierTag === "restrict_end_turn"
    );
    expect(ce).toBeDefined();
    expect(ce!.targetInstanceId).toBe("alice");
  });

  it("alice の効果由来 end_turn は妨害され no-op (受ける)", () => {
    const state = buildRestrictedState();
    const after = executeEndTurn(state, "alice");
    expect(after.step).toBe("attack");
    expect(after.window).toBe("none");
    expect(after.log).toContain("effect:end_turn:blocked-by-restriction:alice");
  });

  it("R12「受けない」(unaffectedByRestriction) は妨害を受けずターン終了 cleanup へ進む", () => {
    const state = buildRestrictedState();
    const queued = executeEndTurn(state, "alice", true);
    expect(queued.pendingTurnEndFinalizations).toHaveLength(1);
    const after = finalizePendingTurnEndFinalizations(queued);
    expect(after.step).toBe("end");
    expect(after.window).toBe("end_step_cleanup");
  });

  it("制限対象でないプレイヤー (bob) の終了は妨害されない", () => {
    const state = buildRestrictedState();
    const queued = executeEndTurn(state, "bob");
    const after = finalizePendingTurnEndFinalizations(queued);
    expect(after.step).toBe("end");
  });

  it("制限が無ければエンドステップを行わずターン終了 cleanup へ進む", () => {
    const base = buildRestrictedState();
    const noRestrict: GameState = {
      ...base,
      activeContinuousEffects: base.activeContinuousEffects.filter(
        (c) => c.modifierTag !== "restrict_end_turn"
      ),
    };
    const queued = executeEndTurn(noRestrict, "alice");
    expect(queued.pendingTurnEndFinalizations).toHaveLength(1);
    const after = finalizePendingTurnEndFinalizations(queued);
    expect(after.step).toBe("end");
    expect(after.window).toBe("end_step_cleanup");
  });

  it("ターン終了はエンドステップ効果窓を開かず、一時 CE を失効する", () => {
    const base = buildRestrictedState();
    const noRestrict: GameState = {
      ...base,
      activeContinuousEffects: [
        ...base.activeContinuousEffects.filter(
          (c) => c.modifierTag !== "restrict_end_turn"
        ),
        {
          effectId: "turn-ce",
          sourceInstanceId: "alice-source",
          sourceDefinitionId: "ALICE-SOURCE",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: base.turnNumber,
          createdAtAttackId: null,
          modifierTag: "bp_modifier",
        },
        {
          effectId: "battle-ce",
          sourceInstanceId: "alice-source",
          sourceDefinitionId: "ALICE-SOURCE",
          actingPlayerId: "alice",
          duration: { scope: "battle" },
          createdAtTurn: base.turnNumber,
          createdAtAttackId: "attack-1",
          modifierTag: "bp_modifier",
        },
        {
          effectId: "step-ce",
          sourceInstanceId: "alice-source",
          sourceDefinitionId: "ALICE-SOURCE",
          actingPlayerId: "alice",
          duration: { scope: "step", step: "attack" },
          createdAtTurn: base.turnNumber,
          createdAtAttackId: null,
          modifierTag: "bp_modifier",
        },
        {
          effectId: "future-start-ce",
          sourceInstanceId: "alice-source",
          sourceDefinitionId: "ALICE-SOURCE",
          actingPlayerId: "alice",
          duration: { scope: "step", step: "start", whose: "self" },
          createdAtTurn: base.turnNumber,
          createdAtAttackId: null,
          modifierTag: "bp_modifier",
        },
      ],
    };

    const queued = executeEndTurn(noRestrict, "alice");
    const after = finalizePendingTurnEndFinalizations(queued);
    expect(after.step).toBe("end");
    expect(after.window).toBe("end_step_cleanup");
    expect(
      after.activeContinuousEffects.map((ce) => ce.effectId)
    ).not.toContain("turn-ce");
    expect(
      after.activeContinuousEffects.map((ce) => ce.effectId)
    ).not.toContain("battle-ce");
    expect(
      after.activeContinuousEffects.map((ce) => ce.effectId)
    ).not.toContain("step-ce");
    expect(after.activeContinuousEffects.map((ce) => ce.effectId)).toContain(
      "future-start-ce"
    );
  });

  it("restrict_end_turn CE は recomputeContinuousEffects 後も player-scoped として残る", () => {
    const state = buildRestrictedState();
    const recomputed = recomputeContinuousEffects(state);
    expect(
      recomputed.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "restrict_end_turn" &&
          ce.targetInstanceId === "alice"
      )
    ).toBe(true);
  });

  it("解決待ちが残る間は実際のターン終了を遅延し、drain 後に finalization する", () => {
    const base = buildRestrictedState();
    const noRestrict: GameState = {
      ...base,
      activeContinuousEffects: base.activeContinuousEffects.filter(
        (c) => c.modifierTag !== "restrict_end_turn"
      ),
    };
    const queued = executeEndTurn(
      {
        ...noRestrict,
        pendingTriggeredEffects: [
          {
            pendingId: "pending-trigger-1",
            actingPlayerId: "bob",
            eventKind: "destroy",
            source: "action_resolution",
            chainId: "chain-1",
            attackId: null,
            relatedPlayerId: null,
            relatedInstanceId: null,
            amount: null,
            step: "attack",
            window: "none",
            resolvedSourceInstanceIds: [],
          } as GameState["pendingTriggeredEffects"][number],
        ],
      },
      "alice"
    );

    const stillWaiting = finalizePendingTurnEndFinalizations(queued);
    expect(stillWaiting.step).toBe("attack");
    expect(stillWaiting.pendingTurnEndFinalizations).toHaveLength(1);

    const afterDrain = finalizePendingTurnEndFinalizations({
      ...stillWaiting,
      pendingTriggeredEffects: [],
    });
    expect(afterDrain.step).toBe("end");
    expect(afterDrain.window).toBe("end_step_cleanup");
    expect(afterDrain.pendingTurnEndFinalizations).toHaveLength(0);
  });

  it("after_triggers continuation が残る間も実際のターン終了を遅延する", () => {
    const base = buildRestrictedState();
    const noRestrict: GameState = {
      ...base,
      activeContinuousEffects: base.activeContinuousEffects.filter(
        (c) => c.modifierTag !== "restrict_end_turn"
      ),
    };
    const queued = executeEndTurn(
      {
        ...noRestrict,
        pendingAfterTriggersContinuations: [
          {
            continuationId: "after-triggers:chain-1:0",
          } as GameState["pendingAfterTriggersContinuations"][number],
        ],
      },
      "alice"
    );

    const stillWaiting = finalizePendingTurnEndFinalizations(queued);
    expect(stillWaiting.step).toBe("attack");
    expect(stillWaiting.pendingTurnEndFinalizations).toHaveLength(1);

    const afterDrain = finalizePendingTurnEndFinalizations({
      ...stillWaiting,
      pendingAfterTriggersContinuations: [],
    });
    expect(afterDrain.step).toBe("end");
    expect(afterDrain.pendingTurnEndFinalizations).toHaveLength(0);
  });

  it("離脱置換 pending が残る間も実際のターン終了を遅延する", () => {
    const base = buildRestrictedState();
    const noRestrict: GameState = {
      ...base,
      activeContinuousEffects: base.activeContinuousEffects.filter(
        (c) => c.modifierTag !== "restrict_end_turn"
      ),
    };

    const withSoulReplacement = executeEndTurn(
      {
        ...noRestrict,
        pendingSoulStateReplacement: {
          choosingPlayerId: "alice",
          cardInstanceId: "contract-1",
          originalLeaveKind: "destroy",
          originalLeaveCause: "effect_resolution",
        },
      },
      "alice"
    );
    expect(finalizePendingTurnEndFinalizations(withSoulReplacement).step).toBe(
      "attack"
    );

    const withAdventReplacement = executeEndTurn(
      {
        ...noRestrict,
        pendingAdventSourceReplacement: {
          choosingPlayerId: "alice",
          cardInstanceId: "advent-source-1",
          candidateHostInstanceIds: ["host-1"],
          originalLeaveKind: "destroy",
          originalLeaveCause: "effect_resolution",
        },
      },
      "alice"
    );
    const stillWaiting = finalizePendingTurnEndFinalizations(
      withAdventReplacement
    );
    expect(stillWaiting.step).toBe("attack");
    expect(stillWaiting.pendingTurnEndFinalizations).toHaveLength(1);

    const afterDrain = finalizePendingTurnEndFinalizations({
      ...stillWaiting,
      pendingAdventSourceReplacement: null,
    });
    expect(afterDrain.step).toBe("end");
    expect(afterDrain.pendingTurnEndFinalizations).toHaveLength(0);
  });

  it("legal action で pending blocker が解消された直後に turn-end finalization する", () => {
    const base = buildRestrictedState();
    const noRestrict: GameState = {
      ...base,
      activeContinuousEffects: base.activeContinuousEffects.filter(
        (c) => c.modifierTag !== "restrict_end_turn"
      ),
    };
    const pendingTriggered: GameState["pendingTriggeredEffects"][number] = {
      pendingId: "pending-trigger-legal-1",
      actingPlayerId: "alice",
      eventKind: "summon",
      source: "action_resolution",
      chainId: "chain-legal-1",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: null,
      amount: null,
      step: "attack",
      window: "none",
      resolvedSourceInstanceIds: [],
      selectedByTurnPlayer: true,
    };
    const queued = executeEndTurn(
      { ...noRestrict, pendingTriggeredEffects: [pendingTriggered] },
      "alice"
    );

    const applied = applyLegalAction({
      state: queued,
      action: {
        chainId: "test:restrict-end-attack-step:493",
        kind: "resolve_pending_triggered_effect",
        actionId: "skip-pending-trigger-legal-1",
        can: true,
        reason: "test",
        actingPlayerId: "alice",
        pendingId: pendingTriggered.pendingId,
        eventKind: pendingTriggered.eventKind,
        executionMode: "optional",
        targetMode: "none",
        requiredTargetCount: 0,
        candidateTargetInstanceIds: [],
        availableChosenLifeCoreKinds: [],
        requiresChosenLifeCoreKind: false,
      },
      skipOptionalEffect: true,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    expect(applied.pendingTriggeredEffects).toHaveLength(0);
    expect(applied.pendingTurnEndFinalizations).toHaveLength(0);
    expect(applied.step).toBe("end");
    expect(applied.window).toBe("end_step_cleanup");
  });

  it("実際のターン終了時に restrict_end_turn が立っていれば予約をキャンセルして続行する", () => {
    const base = buildRestrictedState();
    const noRestrict: GameState = {
      ...base,
      activeContinuousEffects: [],
    };
    const queued = executeEndTurn(
      { ...noRestrict, pendingTriggeredEffects: [] },
      "alice"
    );
    const restrictedAtFinalization: GameState = {
      ...queued,
      activeContinuousEffects: base.activeContinuousEffects,
    };

    const after = finalizePendingTurnEndFinalizations(restrictedAtFinalization);
    expect(after.step).toBe("attack");
    expect(after.window).toBe("none");
    expect(after.pendingTurnEndFinalizations).toHaveLength(0);
    expect(after.log).toContain("effect:end_turn:blocked-by-restriction:alice");
  });
});

describe("BSTH02.7-M01 — Lv2-Lv3 自分のアタックステップ中のステップ/ターン終了制限", () => {
  const cards = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
  const m01 = cards.get("BSTH02.7-M01") as CardDefinition;
  const effect = m01.effects!.find(
    (candidate) =>
      candidate.textRef?.includes(8) && candidate.textRef?.includes(9)
  ) as Effect;
  const lookup = buildTriggeredEffectLookup([m01]);

  it("BSTH02.7-M01 の stub を外し、ステップ終了とターン終了の両方を制限する", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timingScope).toEqual({ player: "self", period: "attack" });
    expect(effect.steps.map((step) => step.action.kind)).toEqual([
      "restrict_end_attack_step",
      "restrict_end_turn",
    ]);
  });

  it("BSTH02.7-M01 は Lv2 以上なら相手への restrict_end_attack_step / restrict_end_turn CE を登録する", () => {
    const source = createCardInstance(m01, {
      instanceId: "m01-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 2,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "none",
    };

    const after = executeEffect({
      chainId: "test:restrict-end-attack-step:577",
      state,
      effect,
      sourceInstanceId: "m01-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cards.get(id),
      getRegisteredTriggeredEffectActions: lookup,
      effectIndex: m01.effects!.indexOf(effect),
    });

    const tagsForBob = after.activeContinuousEffects
      .filter((ce) => ce.targetInstanceId === "bob")
      .map((ce) => ce.modifierTag)
      .sort();

    expect(tagsForBob).toEqual([
      "restrict_end_attack_step",
      "restrict_end_turn",
    ]);
  });
});

describe("BSES01-CX01 — battle / step / turn 終了制限", () => {
  const cards = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
  const cx01 = cards.get("BSES01-CX01") as CardDefinition;
  const yellowBrave = cards.get("BSES01-M01") as CardDefinition;
  const contractSkill = cx01.grandwalkerData!.divineSkills![0]!.effects[0]!;
  const lookup = buildTriggeredEffectLookup([cx01, yellowBrave]);
  const getCardDefinitionById = (id: string) => cards.get(id);

  function buildCxState(options?: {
    yellowSymbol?: boolean;
    countValue?: number;
    playerImmuneBob?: boolean;
  }): GameState {
    const lena = createCardInstance(cx01, {
      instanceId: "cx01-lena",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 2,
    });
    const yellow = createCardInstance(yellowBrave, {
      instanceId: "cx01-yellow-symbol",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: options?.yellowSymbol === false ? "hand" : "field",
      cores: 0,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [lena, yellow],
      playerOverrides: [{ countValue: options?.countValue ?? 2 }, {}],
    });
    return {
      ...base,
      activePlayerId: "alice",
      step: "main",
      window: "none",
      activeContinuousEffects: options?.playerImmuneBob
        ? [
            {
              effectId: "bob-player-immune",
              sourceInstanceId: "bob-immune-source",
              sourceDefinitionId: "TEST-PLAYER-IMMUNE",
              actingPlayerId: "bob",
              duration: { scope: "turn" },
              createdAtTurn: base.turnNumber,
              createdAtAttackId: null,
              modifierTag: "player_effect_immunity",
              targetInstanceId: "bob",
            },
          ]
        : [],
    };
  }

  function useCx01AndDeclineDraw(state: GameState): GameState {
    const afterCount = executeEffect({
      chainId: "test:restrict-end-attack-step:655",
      state,
      effect: contractSkill,
      sourceInstanceId: "cx01-lena",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      effectIndex: 0,
      divineSkillIndex: 0,
    });
    const pending = afterCount.pendingStepOptionalChoice;
    if (!pending) return afterCount;
    return applyLegalAction({
      state: afterCount,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: "decline-cx01-bottom-draw",
        can: true,
        reason: "test",
        actingPlayerId: pending.choosingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
    }).state;
  }

  function withActiveBattle(state: GameState): GameState {
    const activeAttack: ActiveAttack = {
      attackId: "cx01-attack-1",
      primaryEntityId: "cx01-attacker-entity",
      participantEntityIds: ["cx01-attacker-entity"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "cx01-attacker-entity",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["cx01-attacker-entity"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    return {
      ...state,
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId: "cx01-attacker-entity",
          memberInstanceIds: ["cx01-yellow-symbol"],
          resolvedBp: 1000,
          resolvedSymbols: ["yellow"],
          attackState: "attacking",
        },
      ],
    };
  }

  it("契約技後段は黄シンボル時だけ、ドロー辞退後も battle / step / turn 制限を登録する", () => {
    const effect = contractSkill;
    expect(effect.stub).toBeUndefined();
    expect(effect.steps.map((step) => step.action.kind)).toEqual([
      "count_increase",
      "draw",
      "restrict_end_battle",
      "restrict_end_turn",
      "restrict_end_step",
      "restrict_end_attack_step",
    ]);
    expect(effect.steps[1]!.executionMode).toBe("optional");

    const after = useCx01AndDeclineDraw(buildCxState());
    expect(after.pendingStepOptionalChoice).toBeNull();
    expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(4);
    expect(
      after.activeContinuousEffects
        .filter((ce) => ce.targetInstanceId === "bob")
        .map((ce) => ce.modifierTag)
        .sort()
    ).toEqual([
      "restrict_end_attack_step",
      "restrict_end_battle",
      "restrict_end_step",
      "restrict_end_turn",
    ]);
  });

  it("黄シンボルが無ければ count+2 だけ実行し、終了制限も任意ドローも発生しない", () => {
    const after = useCx01AndDeclineDraw(buildCxState({ yellowSymbol: false }));
    expect(after.pendingStepOptionalChoice).toBeNull();
    expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(4);
    expect(after.activeContinuousEffects).toHaveLength(0);
  });

  it.each(["restrict_end_battle", "restrict_end_step"] as const)(
    "%s CE 登録成功は ref_succeeded 後続へ伝播する",
    (kind) => {
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            id: "restrict",
            action: {
              kind,
              player: "opponent",
              duration: { scope: "turn" },
            },
          },
          {
            action: { kind: "count_increase", player: "self", amount: 1 },
            stepCondition: { kind: "ref_succeeded", stepId: "restrict" },
          },
        ],
      } as Effect;
      const after = executeEffect({
        chainId: "test:restrict-end-attack-step:777",
        state: buildCxState(),
        effect,
        sourceInstanceId: "cx01-lena",
        actingPlayerId: "alice",
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: lookup,
      });

      expect(
        after.activeContinuousEffects.some(
          (ce) => ce.modifierTag === kind && ce.targetInstanceId === "bob"
        )
      ).toBe(true);
      expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(3);
    }
  );

  it("相手効果による battle end / step end / turn end を妨害する", () => {
    const restricted = useCx01AndDeclineDraw(buildCxState());

    const battleBlocked = executeEndBattle(
      withActiveBattle(restricted),
      "bob",
      false,
      getCardDefinitionById,
      lookup
    );
    expect(battleBlocked.activeAttack?.attackId).toBe("cx01-attack-1");
    expect(battleBlocked.log).toContain(
      "effect:end_battle:blocked-by-restriction:bob"
    );

    const singleBattleBlocked = executeEndSingleBattle(
      withActiveBattle(restricted),
      "bob",
      false,
      getCardDefinitionById,
      lookup
    );
    expect(singleBattleBlocked.activeAttack?.attackId).toBe("cx01-attack-1");
    expect(singleBattleBlocked.log).toContain(
      "effect:end_single_battle:blocked-by-restriction:bob"
    );

    const stepRestrictedOnly: GameState = {
      ...restricted,
      activeContinuousEffects: restricted.activeContinuousEffects.filter(
        (ce) => ce.modifierTag !== "restrict_end_attack_step"
      ),
    };
    const stepBlocked = executeEndAttackStep(
      { ...stepRestrictedOnly, activePlayerId: "bob", step: "attack" },
      "bob"
    );
    expect(stepBlocked.step).toBe("attack");
    expect(stepBlocked.log).toContain(
      "effect:end_attack_step:blocked-by-restriction:bob"
    );

    const normalStepAdvance = advanceStep(
      {
        ...restricted,
        activePlayerId: "bob",
        step: "main",
        window: "step_end",
      },
      getCardDefinitionById,
      lookup
    );
    expect(normalStepAdvance.step).not.toBe("main");

    const turnBlocked = executeEndTurn(restricted, "bob");
    expect(turnBlocked.pendingTurnEndFinalizations).toHaveLength(0);
    expect(turnBlocked.log).toContain(
      "effect:end_turn:blocked-by-restriction:bob"
    );
  });

  it("発揮済み end_attack_step 予約後に restrict_end_step が立つと実際の終了時に妨害する", () => {
    const queued = executeEndAttackStep(
      { ...buildCxState(), step: "attack", activePlayerId: "alice" },
      "bob"
    );
    expect(queued.pendingAttackStepEndFinalizations).toHaveLength(1);

    const after = useCx01AndDeclineDraw(queued);
    expect(after.step).toBe("attack");
    expect(after.pendingAttackStepEndFinalizations).toHaveLength(0);
    expect(after.log).toContain(
      "effect:end_attack_step:blocked-by-restriction:bob"
    );
  });

  it("count4以上なら、この終了制限 CE は相手の player immunity を貫通して登録される", () => {
    const unpreventable = useCx01AndDeclineDraw(
      buildCxState({ countValue: 2, playerImmuneBob: true })
    );
    expect(
      unpreventable.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "restrict_end_battle" &&
          ce.metadata?.preventionLevel === "unpreventable"
      )
    ).toBe(true);
    const r12StillBlocked = executeEndBattle(
      withActiveBattle(unpreventable),
      "bob",
      true,
      getCardDefinitionById,
      lookup
    );
    expect(r12StillBlocked.activeAttack?.attackId).toBe("cx01-attack-1");
    expect(r12StillBlocked.log).toContain(
      "effect:end_battle:blocked-by-restriction:bob"
    );

    const r12BypassesPreventable = executeEndBattle(
      withActiveBattle(useCx01AndDeclineDraw(buildCxState({ countValue: 1 }))),
      "bob",
      true,
      getCardDefinitionById,
      lookup
    );
    expect(r12BypassesPreventable.activeAttack).toBeNull();

    const preventable = useCx01AndDeclineDraw(
      buildCxState({ countValue: 1, playerImmuneBob: true })
    );
    expect(preventable.players.find((p) => p.id === "alice")!.countValue).toBe(
      3
    );
    expect(
      preventable.activeContinuousEffects.some((ce) =>
        [
          "restrict_end_attack_step",
          "restrict_end_battle",
          "restrict_end_step",
          "restrict_end_turn",
        ].includes(ce.modifierTag)
      )
    ).toBe(false);
  });
});

/**
 * field_has 拡張 (cardNames / battleState)。BSRK01「剣心がいる間」/
 * BSTH06「地霊がアタックしている間」の condition gating に使用。
 */
describe("field_has 拡張 — cardNames / battleState で制限の発動を gating", () => {
  const kenshinDef = {
    cardNo: "KENSHIN-001",
    name: "緋村 剣心",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
  const otherDef = { ...kenshinDef, cardNo: "OTHER-001", name: "別の侍" };

  // condition: 自分の「剣心」がいる間のみ制限を登録。
  const restrictWhenKenshin: Effect = {
    timing: { kind: "continuous" },
    condition: [
      { kind: "field_has", player: "self", cardNames: [{ contains: "剣心" }] },
    ],
    steps: [
      {
        action: {
          kind: "restrict_end_attack_step",
          player: "opponent",
          duration: { scope: "while_on_field" },
        },
      },
    ],
  };
  const lookup = buildTriggeredEffectLookup([kenshinDef, otherDef]);
  const getDef = (id: string) =>
    id === kenshinDef.cardNo
      ? kenshinDef
      : id === otherDef.cardNo
        ? otherDef
        : undefined;

  function register(presentDef: CardDefinition): GameState {
    const nexus = createCardInstance(presentDef, {
      instanceId: "src-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [nexus],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "attack",
      window: "none",
    };
    return executeEffect({
      chainId: "test:restrict-end-attack-step:984",
      state,
      effect: restrictWhenKenshin,
      sourceInstanceId: "src-1",
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      effectIndex: 0,
    });
  }

  it("剣心がいると制限 CE が登録される", () => {
    const state = register(kenshinDef);
    expect(
      state.activeContinuousEffects.some(
        (c) => c.modifierTag === "restrict_end_attack_step"
      )
    ).toBe(true);
  });

  it("剣心がいないと condition 未達で登録されない", () => {
    const state = register(otherDef);
    expect(
      state.activeContinuousEffects.some(
        (c) => c.modifierTag === "restrict_end_attack_step"
      )
    ).toBe(false);
  });
});
