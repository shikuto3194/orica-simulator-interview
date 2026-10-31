import { chooseRuleBraveCores } from "./helpers/rule-brave-choice-driver";
/**
 * 逆転醒（B面→A面）プリミティブ pattern1（flip）の回帰テスト。issues/P3-98。
 *
 * executeReverseRebirth(mode:"flip") は instance.originalDefinitionId（印字=A面 cardNo）へ
 * definitionId を戻すだけ（逆引き index 不要）。コア・instanceId・countValue は不変
 * （裁定 2026-06-14: 逆転醒で count 不変）。
 * pattern2（mode:"summon"）は pendingReverseRebirthSummon を立てて中断し、
 * resolve_reverse_rebirth_summon で支払い/維持コア配置を受け、表面を新 instance として再評価する（P3-98 §3）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  applyTrainingDecisionChoice,
  buildTriggeredEffectLookup,
  collectGameStateInvariantIssues,
  createCardInstance,
  createActionInputDecisionNode,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  getNextTrainingDecision,
  rebuildContinuousEffectsFromField,
  recomputeAndRebuildContinuousEffects,
} from "../src";
import {
  executeRebirth,
  executeReverseRebirth,
} from "../src/effect/structured-effect-interpreter";
import { removeExpiredContinuousEffects } from "../src/legal/legal-actions-shared";
import type {
  CardCostPaymentSource,
  CardDefinition,
  EnterFieldCorePlacement,
  GameState,
  ActiveAttack,
  Engine,
  RebirthAction,
} from "../src";

const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const defMap = new Map<string, CardDefinition>(
  expanded.map((c) => [c.cardNo, c])
);
const getDef = (id: string) => defMap.get(id);
it("有料逆転醒は創界神上の移動できないコアを支払い可能数に含めない", () => {
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      {
        reserveNormalCoreCount: 0,
        reserveSoulCoreCount: 0,
        trashSoulCoreCount: 1,
        soulCoreLocation: { kind: "trash" },
      },
      {},
    ],
    cardInstances: [
      {
        ...createCardInstance(getDef("BSTH06-転醒R01(B)")!, {
          instanceId: "reverse",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        originalDefinitionId: "BSTH06-転醒R01(A)",
      },
      createCardInstance(getDef("BSTH11-X01")!, {
        instanceId: "god",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 5,
      }),
    ],
  });
  const result = executeReverseRebirth(
    state,
    "alice",
    { kind: "reverse_rebirth", mode: "summon" },
    "reverse",
    getDef
  );
  expect(result.pendingReverseRebirthSummon).toBeNull();
  expect(
    result.cardInstances.find((c) => c.instanceId === "reverse")?.definitionId
  ).toBe("BSTH06-転醒R01(B)");
  expect(
    result.cardInstances.find((c) => c.instanceId === "god")?.normalCoreCount
  ).toBe(5);
});
const triggeredLookup = buildTriggeredEffectLookup(expanded);
const trainingEngine: Engine = {
  cards: expanded,
  getCardDefinitionById: getDef,
  lookups: {
    getCardDefinitionById: getDef,
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredTriggeredEffectActions: triggeredLookup,
    getRegisteredBattleImmediateEffectActions: () => [],
    getRegisteredBurstActions: () => [],
    getRegisteredHandActivatedEffectActions: () => [],
    getRegisteredMagicActions: () => [],
  },
};

function reverseRebirthNewInstanceId(
  pending: NonNullable<GameState["pendingReverseRebirthSummon"]>
): string {
  return `${pending.sourceInstanceId}:reverse-rebirth:${pending.pendingId}`;
}

/** pendingReverseRebirthSummon を resolve アクションで解決する（支払い/配置は任意）。 */
function resolveReverseRebirth(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  opts?: {
    summonPaymentSources?: readonly CardCostPaymentSource[];
    summonEnterFieldCorePlacements?: readonly EnterFieldCorePlacement[];
    getRegisteredTriggeredEffectActions?: ReturnType<
      typeof buildTriggeredEffectLookup
    >;
  }
): GameState {
  const pending = state.pendingReverseRebirthSummon!;
  return applyLegalAction({
    state,
    action: {
      kind: "resolve_reverse_rebirth_summon",
      actionId: `rr-resolve-${pending.pendingId}`,
      can: true,
      reason: "test",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.sourceInstanceId,
      frontDefinitionId: pending.frontDefinitionId,
      costToPay: pending.costToPay,
      minimumCoreCount: pending.minimumCoreCount,
    },
    getCardDefinitionById,
    ...(opts?.getRegisteredTriggeredEffectActions
      ? {
          getRegisteredTriggeredEffectActions:
            opts.getRegisteredTriggeredEffectActions,
        }
      : {}),
    ...(opts?.summonPaymentSources
      ? { summonPaymentSources: opts.summonPaymentSources }
      : {}),
    ...(opts?.summonEnterFieldCorePlacements
      ? {
          summonEnterFieldCorePlacements: opts.summonEnterFieldCorePlacements,
        }
      : {}),
  }).state;
}

function rebornInstanceOnField(): GameState {
  const frontDef = getDef("BSTH03-転醒R01(A)")!;
  const inst = createCardInstance(frontDef, {
    instanceId: "nx-1",
    ownerPlayerId: "alice",
    zone: "field",
    zoneRoleName: "nexus",
    normalCoreCount: 2,
  });
  const before: GameState = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [inst],
  });
  // A→B flip（転醒）してから逆転醒で戻す。countValue は executeRebirth が +1 する。
  const rebirth: RebirthAction = {
    kind: "rebirth",
    maxCount: 3,
    triggerDescription: "",
  };
  return executeRebirth(
    before,
    "alice",
    rebirth,
    "nx-1",
    getDef,
    "test:reverse-rebirth:176"
  );
}

describe("逆転醒 reverse_rebirth pattern1(flip)", () => {
  it("flip: B面→A面へ definitionId を戻し、コア・instanceId は保持、count は不変", () => {
    const reborn = rebornInstanceOnField();
    const bInst = reborn.cardInstances.find((c) => c.instanceId === "nx-1")!;
    expect(bInst.definitionId).toBe("BSTH03-転醒R01(B)");
    expect(bInst.originalDefinitionId).toBe("BSTH03-転醒R01(A)");
    const countAfterRebirth = reborn.players.find(
      (p) => p.id === "alice"
    )!.countValue;

    const after = executeReverseRebirth(
      reborn,
      "alice",
      { kind: "reverse_rebirth", mode: "flip" },
      "nx-1",
      getDef
    );

    const aInst = after.cardInstances.find((c) => c.instanceId === "nx-1")!;
    // A 面へ戻る。
    expect(aInst.definitionId).toBe("BSTH03-転醒R01(A)");
    // instanceId・コアは保持。
    expect(aInst.instanceId).toBe("nx-1");
    expect(aInst.normalCoreCount).toBe(bInst.normalCoreCount);
    // count は逆転醒で変動しない（裁定 2026-06-14）。
    expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(
      countAfterRebirth
    );
  });

  it("既に A 面のカードへ flip すると no-op（definitionId 不変）", () => {
    const frontDef = getDef("BSTH03-転醒R01(A)")!;
    const inst = createCardInstance(frontDef, {
      instanceId: "nx-2",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 0,
    });
    const state: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst],
    });
    const after = executeReverseRebirth(
      state,
      "alice",
      { kind: "reverse_rebirth", mode: "flip" },
      "nx-2",
      getDef
    );
    expect(
      after.cardInstances.find((c) => c.instanceId === "nx-2")!.definitionId
    ).toBe("BSTH03-転醒R01(A)");
  });

  it("A面自己continuous CEは転醒後の再計算で失効し、B面の存在しないeffectIndexを指さない", () => {
    const frontDef = getDef("BSTH03-転醒R01(A)")!;
    const inst = createCardInstance(frontDef, {
      instanceId: "nx-ce",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 1,
    });
    const state: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst],
    });
    const registered = rebuildContinuousEffectsFromField(state, getDef, {
      unsafeAllowDuringBattle: true,
    });
    expect(
      registered.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "nx-ce" &&
          ce.sourceDefinitionId === "BSTH03-転醒R01(A)" &&
          ce.provenance?.effectIndex === 3
      )
    ).toBe(true);

    const rebirth: RebirthAction = {
      kind: "rebirth",
      maxCount: 3,
      triggerDescription: "",
    };
    const reborn = executeRebirth(
      registered,
      "alice",
      rebirth,
      "nx-ce",
      getDef,
      "test:reverse-rebirth:264"
    );
    expect(
      reborn.cardInstances.find((c) => c.instanceId === "nx-ce")!.definitionId
    ).toBe("BSTH03-転醒R01(B)");

    const recomputed = recomputeAndRebuildContinuousEffects(reborn, getDef);
    expect(
      recomputed.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "nx-ce" &&
          ce.sourceDefinitionId === "BSTH03-転醒R01(A)" &&
          ce.provenance?.effectIndex === 3
      )
    ).toBe(false);
    expect(
      collectGameStateInvariantIssues(recomputed, {
        getCardDefinitionById: getDef,
      }).filter((issue) => issue.code === "stale_continuous_effect")
    ).toHaveLength(0);
  });

  it("A面stackの『次のバトル終了後まで』は転醒後も保持し、次のバトルで失効する", () => {
    const braveDef = getDef("BSFT01-TR02(A)")!;
    const lucyDef = getDef("BSFT01-CX01")!;
    const brave = createCardInstance(braveDef, {
      instanceId: "tr02-stack-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 0,
    });
    const lucy = createCardInstance(lucyDef, {
      instanceId: "lucy-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const activeAttack: ActiveAttack = {
      attackId: "attack:tr02-stack-rebirth:1",
      primaryEntityId: "be-lucy",
      participantEntityIds: ["be-lucy"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "be-lucy", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["be-lucy"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
        cardInstances: [brave, lucy],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "flash",
      activeAttack,
      battleEntities: [
        {
          entityId: "be-lucy",
          memberInstanceIds: ["lucy-target"],
          resolvedBp: 2000,
          resolvedSymbols: ["blue"],
          attackState: "attacking",
        },
      ],
    };
    const effect = braveDef.effects![1]!;
    const afterBody = executeEffect({
      chainId: "test:reverse-rebirth:345",
      state,
      effect,
      sourceInstanceId: "tr02-stack-source",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      effectIndex: 1,
      targetInstanceIds: ["lucy-target"],
    });
    const battleCeBefore = afterBody.activeContinuousEffects.find(
      (ce) =>
        ce.sourceInstanceId === "tr02-stack-source" &&
        ce.sourceDefinitionId === "BSFT01-TR02(A)" &&
        ce.targetInstanceId === "lucy-target" &&
        ce.modifierTag === "defense_immune" &&
        ce.duration.scope === "battle" &&
        ce.provenance?.effectIndex === 1
    );
    expect(battleCeBefore).toBeDefined();
    expect(battleCeBefore!.timingScope).toEqual({
      player: "both",
      period: "attack",
    });

    const pending = afterBody.pendingStepOptionalChoice!;
    const afterRebirthChoice = applyLegalAction({
      state: afterBody,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    const coreAction = getLegalActions({
      state: afterRebirthChoice,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find((action) => action.kind === "resolve_pending_core_distribution");
    expect(coreAction).toBeDefined();
    const afterRebirth = applyLegalAction({
      state: afterRebirthChoice,
      action: coreAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      coreDistributionAllocations: { "tr02-stack-source": 1 },
      coreDistributionSourceAllocations: { reserve: 1 },
    }).state;
    expect(
      afterRebirth.cardInstances.find(
        (card) => card.instanceId === "tr02-stack-source"
      )!.definitionId
    ).toBe("BSFT01-TR02(B)");

    const recomputed = recomputeAndRebuildContinuousEffects(
      afterRebirth,
      getDef
    );
    expect(
      recomputed.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "tr02-stack-source" &&
          ce.sourceDefinitionId === "BSFT01-TR02(A)" &&
          ce.targetInstanceId === "lucy-target" &&
          ce.modifierTag === "defense_immune" &&
          ce.duration.scope === "battle" &&
          ce.provenance?.effectIndex === 1
      )
    ).toBe(true);
    expect(
      recomputed.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "tr02-stack-source" &&
          ce.sourceDefinitionId === "BSFT01-TR02(B)" &&
          ce.modifierTag === "life_damage_interception" &&
          ce.duration.scope === "while_on_field" &&
          ce.provenance?.effectIndex === 1
      )
    ).toBe(true);
    expect(
      collectGameStateInvariantIssues(recomputed, {
        getCardDefinitionById: getDef,
      }).filter((issue) => issue.code === "stale_continuous_effect")
    ).toHaveLength(0);

    const afterBattleEnd: GameState = {
      ...recomputed,
      activeContinuousEffects: removeExpiredContinuousEffects(recomputed, {
        kind: "battle_end",
        attackId: activeAttack.attackId,
      }),
      activeAttack: null,
      battleEntities: [],
    };
    expect(
      afterBattleEnd.activeContinuousEffects.some(
        (ce) => ce.effectId === battleCeBefore!.effectId
      )
    ).toBe(true);
    expect(
      collectGameStateInvariantIssues(afterBattleEnd, {
        getCardDefinitionById: getDef,
      }).filter((issue) => issue.code === "stale_continuous_effect")
    ).toHaveLength(0);
    const afterNextBattle = removeExpiredContinuousEffects(afterBattleEnd, {
      kind: "battle_end",
      attackId: "attack:tr02-stack-rebirth:2",
    });
    expect(
      afterNextBattle.some((ce) => ce.effectId === battleCeBefore!.effectId)
    ).toBe(false);
  });

  it("A面flash効果が作ったturn期間CEは転醒後の再計算でも保持する", () => {
    const braveDef = getDef("BSFT01-TR01(A)")!;
    const lucyDef = getDef("BSFT01-CX01")!;
    const lucy = createCardInstance(lucyDef, {
      instanceId: "lucy-turn-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
      attachedChildrenIds: ["tr01-flash-source"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "tr01-flash-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
      attachedToInstanceId: "lucy-turn-host",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [lucy, brave],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "flash",
    };
    const effect = braveDef.effects![1]!;
    const afterBody = executeEffect({
      chainId: "test:reverse-rebirth:499",
      state,
      effect,
      sourceInstanceId: "tr01-flash-source",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      effectIndex: 1,
    });
    const turnCeBefore = afterBody.activeContinuousEffects.find(
      (ce) =>
        ce.sourceInstanceId === "tr01-flash-source" &&
        ce.sourceDefinitionId === "BSFT01-TR01(A)" &&
        ce.modifierTag === "effect_source_prevention_immunity" &&
        ce.duration.scope === "turn" &&
        ce.provenance?.effectIndex === 1
    );
    expect(turnCeBefore).toBeDefined();

    const pending = afterBody.pendingStepOptionalChoice!;
    const afterRebirthChoice = applyLegalAction({
      state: afterBody,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    const coreAction = getLegalActions({
      state: afterRebirthChoice,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find((action) => action.kind === "resolve_pending_core_distribution");
    const afterRebirth =
      coreAction === undefined
        ? afterRebirthChoice
        : applyLegalAction({
            state: afterRebirthChoice,
            action: coreAction,
            getCardDefinitionById: getDef,
            getRegisteredTriggeredEffectActions: triggeredLookup,
            coreDistributionAllocations: { "tr01-flash-source": 0 },
            coreDistributionSourceAllocations: {},
          }).state;
    expect(
      afterRebirth.cardInstances.find(
        (card) => card.instanceId === "tr01-flash-source"
      )!.definitionId
    ).toBe("BSFT01-TR01(B)");

    const recomputed = recomputeAndRebuildContinuousEffects(
      afterRebirth,
      getDef
    );
    expect(
      recomputed.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "tr01-flash-source" &&
          ce.sourceDefinitionId === "BSFT01-TR01(A)" &&
          ce.modifierTag === "effect_source_prevention_immunity" &&
          ce.duration.scope === "turn" &&
          ce.provenance?.effectIndex === 1
      )
    ).toBe(true);
    expect(
      recomputed.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "tr01-flash-source" &&
          ce.sourceDefinitionId === "BSFT01-TR01(B)" &&
          ce.modifierTag === "field_name_uniqueness" &&
          ce.duration.scope === "while_on_field" &&
          ce.provenance?.effectIndex === 1
      )
    ).toBe(true);
    expect(
      collectGameStateInvariantIssues(recomputed, {
        getCardDefinitionById: getDef,
      }).filter((issue) => issue.code === "stale_continuous_effect")
    ).toHaveLength(0);

    const afterTurnEnd: GameState = {
      ...recomputed,
      activeContinuousEffects: removeExpiredContinuousEffects(recomputed, {
        kind: "turn_end",
      }),
    };
    expect(
      afterTurnEnd.activeContinuousEffects.some(
        (ce) => ce.effectId === turnCeBefore!.effectId
      )
    ).toBe(false);
    expect(
      collectGameStateInvariantIssues(afterTurnEnd, {
        getCardDefinitionById: getDef,
      }).filter((issue) => issue.code === "stale_continuous_effect")
    ).toHaveLength(0);
  });

  it("mode:summon（withoutCost なし）: 軽減後コストをリザーブから auto-pay して裏返して配置", () => {
    const reborn = rebornInstanceOnField();
    // BSTH03-転醒R01(A): cost 3 / 軽減 [green,red] / Lv1 requiredCores 0。
    // 場のシンボル供給は自身(nx-1, 除外)のみ → 軽減 0 → コスト 3。
    const reserveBefore = reborn.players.find(
      (p) => p.id === "alice"
    )!.reserveNormalCoreCount; // 4
    const trashBefore = reborn.players.find(
      (p) => p.id === "alice"
    )!.trashNormalCoreCount; // 0
    const coresOnCard = reborn.cardInstances.find(
      (c) => c.instanceId === "nx-1"
    )!.normalCoreCount; // 2
    const countBefore = reborn.players.find(
      (p) => p.id === "alice"
    )!.countValue;

    const pendingState = executeReverseRebirth(
      reborn,
      "alice",
      { kind: "reverse_rebirth", mode: "summon" },
      "nx-1",
      getDef
    );
    // pending を立て、盤面は未変更（まだ B 面）。
    expect(pendingState.pendingReverseRebirthSummon).not.toBeNull();
    expect(pendingState.pendingReverseRebirthSummon!.costToPay).toBe(3);
    expect(
      pendingState.cardInstances.find((c) => c.instanceId === "nx-1")!
        .definitionId
    ).toBe("BSTH03-転醒R01(B)");

    const newInstanceId = reverseRebirthNewInstanceId(
      pendingState.pendingReverseRebirthSummon!
    );
    const after = resolveReverseRebirth(pendingState, getDef); // 支払いソース省略 → auto-pay
    expect(after.cardInstances.some((c) => c.instanceId === "nx-1")).toBe(
      false
    );
    const aInst = after.cardInstances.find(
      (c) => c.instanceId === newInstanceId
    )!;
    expect(aInst.definitionId).toBe("BSTH03-転醒R01(A)");
    // 維持コア0 → カードは 0 コア。
    expect(
      after.publicDisclosures
        ?.flatMap((entry) => entry.results)
        .filter(
          (result) =>
            result.instanceId === newInstanceId && result.kind === "card_move"
        )
    ).toEqual([expect.objectContaining({ actionLabel: "place" })]);
    expect(aInst.normalCoreCount).toBe(0);
    const alice = after.players.find((p) => p.id === "alice")!;
    // コア→リザーブ(reserveBefore+2)→コスト3 をトラッシュへ。
    expect(alice.reserveNormalCoreCount).toBe(reserveBefore + coresOnCard - 3);
    expect(alice.trashNormalCoreCount).toBe(trashBefore + 3);
    // 逆転醒で count 不変。
    expect(alice.countValue).toBe(countBefore);
    expect(after.pendingReverseRebirthSummon).toBeNull();
  });

  it("mode:summon: 相手効果による離脱待機を置換し、旧 instance の stale pending leave を残さない", () => {
    const frontDef = getDef("BSTH005-TX01(A)")!;
    const instanceId = "makai-root-return";
    const front = createCardInstance(frontDef, {
      instanceId,
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [front],
    });
    const reborn = executeRebirth(
      {
        ...base,
        players: base.players.map((player) =>
          player.id === "alice"
            ? { ...player, reserveNormalCoreCount: 3 }
            : player
        ),
      },
      "alice",
      { kind: "rebirth", maxCount: 9, triggerDescription: "test" },
      instanceId,
      getDef,
      "test:reverse-rebirth:683"
    );
    const waiting: GameState = {
      ...reborn,
      cardInstances: reborn.cardInstances.map((card) =>
        card.instanceId === instanceId
          ? {
              ...card,
              pendingLeaveKind: "destroy",
              pendingLeaveCause: "opponent_effect",
              pendingLeaveChainId: "makai-root-return-leave",
            }
          : card
      ),
      pendingLeaveEntities: [
        {
          instanceId,
          kind: "destroy",
          cause: "opponent_effect",
          causePlayerId: "bob",
          chainId: "makai-root-return-leave",
          deferZoneMoveUntilChainEnd: false,
        },
      ],
      // 同じ未成立の離脱に由来する通常/遅延誘発も、root return が離脱を
      // 置換した場合には解決候補として残してはならない。
      pendingTriggeredEffects: [
        {
          pendingId: "makai-root-return-trigger",
          actingPlayerId: "bob",
          eventKind: "remove_from_game",
          source: "action_resolution",
          chainId: "makai-root-return-leave",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: instanceId,
          amount: 1,
          step: "attack",
          window: "none",
          resolvedSourceInstanceIds: [],
          simultaneousGroupId: "makai-root-return-leave",
        },
        // 同じ旧 instance に結び付いても、別チェーンの非離脱イベントは今回の
        // 置換と無関係なので残す。
        {
          pendingId: "makai-root-return-unrelated-trigger",
          actingPlayerId: "bob",
          eventKind: "attack",
          source: "action_resolution",
          chainId: "unrelated-chain",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: instanceId,
          amount: null,
          step: "attack",
          window: "none",
          resolvedSourceInstanceIds: [],
          declaredFromPrivateZone: true,
        },
      ],
      pendingDeferredTriggeredEffects: [
        {
          pendingId: "makai-root-return-deferred-trigger",
          actingPlayerId: "bob",
          eventKind: "destroy",
          source: "action_resolution",
          chainId: "makai-root-return-leave",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: instanceId,
          amount: null,
          step: "attack",
          window: "none",
          resolvedSourceInstanceIds: [],
          simultaneousGroupId: "makai-root-return-leave",
        },
      ],
      pendingPrivateDeclarations: [
        {
          declarationId: "makai-root-return-private-declaration",
          ownerPlayerId: "bob",
          actingPlayerId: "bob",
          sourceInstanceId: "private-leave-source",
          sourceDefinitionId: "BSTH005-TX01(A)",
          sourceKind: "nexus",
          sourceZone: "hand",
          registrationIndex: 0,
          pendingId: "makai-root-return-private-trigger",
          eventKind: "remove_from_game",
          source: "action_resolution",
          chainId: "makai-root-return-leave",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: instanceId,
          amount: null,
          step: "attack",
          window: "none",
        },
      ],
      // 実移動前に確認済みの「離脱後」バースト。root return が離脱を
      // 置換した場合には、このチェックも撤回されなければならない。
      pendingBurstChecks: [
        {
          checkId: "makai-root-return-burst",
          actingPlayerId: "bob",
          eventKind: "remove_from_game",
          source: "action_resolution",
          chainId: "makai-root-return-leave",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: instanceId,
          amount: 1,
          step: "attack",
          window: "none",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    };

    const pending = executeReverseRebirth(
      waiting,
      "alice",
      { kind: "reverse_rebirth", mode: "summon" },
      instanceId,
      getDef
    );
    const newInstanceId = reverseRebirthNewInstanceId(
      pending.pendingReverseRebirthSummon!
    );
    const after = resolveReverseRebirth(pending, getDef);

    expect(
      after.cardInstances.some((card) => card.instanceId === instanceId)
    ).toBe(false);
    expect(
      after.cardInstances.find((card) => card.instanceId === newInstanceId)
    ).toMatchObject({
      definitionId: "BSTH005-TX01(A)",
      zone: "field",
      pendingLeaveKind: null,
    });
    expect(
      after.pendingLeaveEntities.some(
        (pendingLeave) => pendingLeave.instanceId === instanceId
      )
    ).toBe(false);
    expect(
      after.pendingBurstChecks.some(
        (burstCheck) => burstCheck.checkId === "makai-root-return-burst"
      )
    ).toBe(false);
    expect(
      after.pendingTriggeredEffects.some(
        (pendingEffect) =>
          pendingEffect.pendingId === "makai-root-return-trigger"
      )
    ).toBe(false);
    expect(
      after.pendingDeferredTriggeredEffects.some(
        (pendingEffect) =>
          pendingEffect.pendingId === "makai-root-return-deferred-trigger"
      )
    ).toBe(false);
    expect(
      after.pendingPrivateDeclarations.some(
        (declaration) =>
          declaration.declarationId === "makai-root-return-private-declaration"
      )
    ).toBe(false);
    expect(
      after.pendingTriggeredEffects.some(
        (pendingEffect) =>
          pendingEffect.pendingId === "makai-root-return-unrelated-trigger"
      )
    ).toBe(true);
    expect(
      getLegalActions({
        state: after,
        actingPlayerId: "bob",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: () => [],
      }).some(
        (action) =>
          (action.kind === "resolve_pending_burst_check" ||
            action.kind === "decline_pending_burst_check") &&
          action.checkId === "makai-root-return-burst"
      )
    ).toBe(false);
    expect(
      getLegalActions({
        state: after,
        actingPlayerId: "bob",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: () => [],
      }).some(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.pendingId === "makai-root-return-trigger"
      )
    ).toBe(false);
    expect(
      after.log.some(
        (entry) => entry === `reverse_rebirth:stay-on-field:${instanceId}`
      )
    ).toBe(true);
  });

  it("mode:summon: 離脱を置換する根幻回帰でも合体ブレイヴの残存/同行選択を残し、孤児リンクにしない", () => {
    const frontDef = getDef("BSTH005-TX01(A)")!;
    const {
      backFace: _backFace,
      isDoubleSided: _isDoubleSided,
      ...normalBraveBase
    } = frontDef;
    const normalBraveDef: CardDefinition = {
      ...normalBraveBase,
      cardNo: "RR-NORMAL-BRAVE",
      name: "normal brave for reverse rebirth",
      printedCategory: "brave",
      // B 面では適法に合体しているが、reverse rebirth 後の A 面 (nexus) では
      // 合体できない通常ブレイヴとして SBA 分離を起こす。
      braveCondition: { categories: ["spirit"] },
      effects: [],
      textLines: [],
      keywordTags: [],
    };
    const synthDefs = new Map(defMap);
    synthDefs.set(normalBraveDef.cardNo, normalBraveDef);
    const getDefWithNormalBrave = (id: string) => synthDefs.get(id);
    const instanceId = "makai-root-return-with-brave";
    const braveInstanceId = "makai-root-return-attached-brave";
    const front = createCardInstance(frontDef, {
      instanceId,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 1,
      attachedChildrenIds: [braveInstanceId],
    });
    const brave = createCardInstance(normalBraveDef, {
      instanceId: braveInstanceId,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 0,
      attachedToInstanceId: instanceId,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [front, brave],
    });
    const reborn = executeRebirth(
      {
        ...base,
        players: base.players.map((player) =>
          player.id === "alice"
            ? { ...player, reserveNormalCoreCount: 3 }
            : player
        ),
      },
      "alice",
      { kind: "rebirth", maxCount: 9, triggerDescription: "test" },
      instanceId,
      getDefWithNormalBrave,
      "test:reverse-rebirth:950"
    );
    const waiting: GameState = {
      ...reborn,
      cardInstances: reborn.cardInstances.map((card) =>
        card.instanceId === instanceId
          ? {
              ...card,
              pendingLeaveKind: "destroy",
              pendingLeaveCause: "opponent_effect",
              pendingLeaveChainId: "makai-root-return-with-brave-leave",
              exhaustState: "exhausted",
            }
          : card
      ),
      pendingLeaveEntities: [
        {
          instanceId,
          kind: "destroy",
          cause: "opponent_effect",
          causePlayerId: "bob",
          chainId: "makai-root-return-with-brave-leave",
          deferZoneMoveUntilChainEnd: false,
        },
      ],
    };

    const pending = executeReverseRebirth(
      waiting,
      "alice",
      { kind: "reverse_rebirth", mode: "summon" },
      instanceId,
      getDefWithNormalBrave
    );
    const newInstanceId = reverseRebirthNewInstanceId(
      pending.pendingReverseRebirthSummon!
    );
    const after = resolveReverseRebirth(pending, getDefWithNormalBrave);

    expect(after.pendingBraveLeaveChoice).toMatchObject({
      choosingPlayerId: "alice",
      hostInstanceId: newInstanceId,
      braveInstanceIds: [braveInstanceId],
      leaveKind: "destroy",
      leaveCause: "opponent_effect",
    });
    // 先に旧B面の離脱に対する残存/同行を選ぶ。SBAの別コア選択は重ねない。
    expect(after.pendingCoreDistribution).toBeNull();
    expect(
      after.cardInstances.find((card) => card.instanceId === newInstanceId)
        ?.attachedChildrenIds
    ).toEqual([braveInstanceId]);
    expect(
      after.cardInstances.find((card) => card.instanceId === braveInstanceId)
        ?.attachedToInstanceId
    ).toBe(newInstanceId);
    expect(
      collectGameStateInvariantIssues(after, {
        getCardDefinitionById: getDefWithNormalBrave,
      }).filter(
        (issue) =>
          issue.code === "missing_attached_parent" ||
          issue.code === "attached_child_parent_mismatch"
      )
    ).toHaveLength(0);

    const braveLeaveChoices = getLegalActions({
      state: after,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
    });
    const keep = braveLeaveChoices.find(
      (action) =>
        action.kind === "resolve_brave_leave_choice" && action.choice === "keep"
    );
    const sendWithHost = braveLeaveChoices.find(
      (action) =>
        action.kind === "resolve_brave_leave_choice" &&
        action.choice === "send_with_host"
    );
    expect(keep).toBeDefined();
    expect(sendWithHost).toBeDefined();
    if (!keep) return;

    const kept = applyLegalAction({
      state: after,
      action: keep,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
    }).state;
    expect(kept.pendingBraveLeaveChoice).toBeNull();
    expect(
      kept.cardInstances.find((card) => card.instanceId === newInstanceId)
        ?.attachedChildrenIds
    ).toEqual([]);
    expect(
      kept.cardInstances.find((card) => card.instanceId === braveInstanceId)
    ).toMatchObject({
      zone: "field",
      attachedToInstanceId: null,
      // Q30232 / Q21697: 疲労した合体スピリットから分離した通常ブレイヴも疲労。
      exhaustState: "exhausted",
    });
    expect(
      collectGameStateInvariantIssues(kept, {
        getCardDefinitionById: getDefWithNormalBrave,
      }).filter(
        (issue) =>
          issue.code === "missing_attached_parent" ||
          issue.code === "attached_child_parent_mismatch"
      )
    ).toHaveLength(0);

    if (!sendWithHost) return;
    const sentWithHost = applyLegalAction({
      state: after,
      action: sendWithHost,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
    }).state;
    expect(
      sentWithHost.cardInstances.find(
        (card) => card.instanceId === braveInstanceId
      )?.zone
    ).toBe("trash");
  });

  it("mode:summon: 通常変換でも B 面ホストの疲労を強制分離ブレイヴへ引き継ぐ", () => {
    const frontDef = getDef("BSLH01-TR03(A)")!;
    const backDef = getDef("BSLH01-TR03(B)")!;
    const {
      backFace: _backFace,
      isDoubleSided: _isDoubleSided,
      ...normalBraveBase
    } = frontDef;
    const normalBraveDef: CardDefinition = {
      ...normalBraveBase,
      cardNo: "RR-TR03-NORMAL-BRAVE",
      name: "normal brave for regular reverse rebirth",
      printedCategory: "brave",
      // B 面スピリットでは適法、A 面ネクサスでは不適法なので通常の SBA 分離となる。
      braveCondition: { categories: ["spirit"] },
      effects: [],
      textLines: [],
      keywordTags: [],
    };
    const synthDefs = new Map(defMap);
    synthDefs.set(normalBraveDef.cardNo, normalBraveDef);
    const getDefWithNormalBrave = (id: string) => synthDefs.get(id);
    const hostInstanceId = "tr03-regular-reverse-host";
    const braveInstanceId = "tr03-regular-reverse-brave";
    const host = {
      ...createCardInstance(backDef, {
        instanceId: hostInstanceId,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        zoneRoleName: "spirit",
        normalCoreCount: 2,
        exhaustState: "exhausted",
        attachedChildrenIds: [braveInstanceId],
      }),
      // createCardInstance は cardNo を元表面として初期化するため、実際に B 面へ
      // 転醒済みの instance と同じ originalDefinitionId を fixture で明示する。
      originalDefinitionId: frontDef.cardNo,
    };
    const brave = createCardInstance(normalBraveDef, {
      instanceId: braveInstanceId,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: hostInstanceId,
    });
    const pending = executeReverseRebirth(
      createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave],
      }),
      "alice",
      { kind: "reverse_rebirth", mode: "summon", withoutCost: true },
      hostInstanceId,
      getDefWithNormalBrave
    );
    const newInstanceId = reverseRebirthNewInstanceId(
      pending.pendingReverseRebirthSummon!
    );
    let after = resolveReverseRebirth(pending, getDefWithNormalBrave);
    after = chooseRuleBraveCores(after, getDefWithNormalBrave, braveInstanceId);

    expect(after.pendingBraveLeaveChoice).toBeNull();
    expect(
      after.cardInstances.find((card) => card.instanceId === newInstanceId)
        ?.definitionId
    ).toBe(frontDef.cardNo);
    expect(
      after.cardInstances.find((card) => card.instanceId === braveInstanceId)
    ).toMatchObject({
      zone: "field",
      attachedToInstanceId: null,
      // Q30232 / Q21697: 通常変換でも、疲労した B 面から分離した通常ブレイヴは疲労。
      exhaustState: "exhausted",
    });
    expect(
      after.reverseRebirthBraveSeparationExhaustSnapshots?.[braveInstanceId]
    ).toBeUndefined();
  });

  it("mode:summon: 通常変換の分離コア選択にも B 面ホストの疲労を保持する", () => {
    const frontDef = getDef("BSLH01-TR03(A)")!;
    const backDef = getDef("BSLH01-TR03(B)")!;
    const {
      backFace: _backFace,
      isDoubleSided: _isDoubleSided,
      ...normalBraveBase
    } = frontDef;
    const normalBraveDef: CardDefinition = {
      ...normalBraveBase,
      cardNo: "RR-TR03-PENDING-NORMAL-BRAVE",
      name: "normal brave for regular reverse rebirth core pending",
      printedCategory: "brave",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      braveCondition: { categories: ["spirit"] },
      effects: [],
      textLines: [],
      keywordTags: [],
    };
    const synthDefs = new Map(defMap);
    synthDefs.set(normalBraveDef.cardNo, normalBraveDef);
    const getDefWithNormalBrave = (id: string) => synthDefs.get(id);
    const hostInstanceId = "tr03-regular-reverse-pending-host";
    const braveInstanceId = "tr03-regular-reverse-pending-brave";
    const host = {
      ...createCardInstance(backDef, {
        instanceId: hostInstanceId,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        zoneRoleName: "spirit",
        exhaustState: "exhausted",
        attachedChildrenIds: [braveInstanceId],
      }),
      originalDefinitionId: frontDef.cardNo,
    };
    const brave = createCardInstance(normalBraveDef, {
      instanceId: braveInstanceId,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: hostInstanceId,
    });
    const donor = createCardInstance(frontDef, {
      instanceId: "tr03-regular-reverse-core-donor",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 1,
    });
    const pending = executeReverseRebirth(
      createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave, donor],
        playerOverrides: [{ reserveNormalCoreCount: 1 }],
      }),
      "alice",
      { kind: "reverse_rebirth", mode: "summon", withoutCost: true },
      hostInstanceId,
      getDefWithNormalBrave
    );
    const after = resolveReverseRebirth(pending, getDefWithNormalBrave);

    expect(after.pendingCoreDistribution?.stateBasedBraveSeparation).toEqual({
      hostInstanceId: reverseRebirthNewInstanceId(
        pending.pendingReverseRebirthSummon!
      ),
      braveInstanceId,
      hostExhaustState: "exhausted",
    });
    expect(
      after.reverseRebirthBraveSeparationExhaustSnapshots?.[braveInstanceId]
    ).toBe("exhausted");
    const resolved = chooseRuleBraveCores(
      after,
      getDefWithNormalBrave,
      braveInstanceId,
      { reserve: 1 }
    );
    expect(
      resolved.reverseRebirthBraveSeparationExhaustSnapshots?.[braveInstanceId]
    ).toBeUndefined();
    expect(
      resolved.cardInstances.find((card) => card.instanceId === braveInstanceId)
    ).toMatchObject({
      attachedToInstanceId: null,
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
  });

  it("mode:summon: 支払いソースを明示選択（reserve から）して配置", () => {
    const reborn = rebornInstanceOnField();
    const pendingState = executeReverseRebirth(
      reborn,
      "alice",
      { kind: "reverse_rebirth", mode: "summon" },
      "nx-1",
      getDef
    );
    const after = resolveReverseRebirth(pendingState, getDef, {
      summonPaymentSources: [{ kind: "reserve", amount: 3 }],
    });
    const newInstanceId = reverseRebirthNewInstanceId(
      pendingState.pendingReverseRebirthSummon!
    );
    expect(
      after.cardInstances.find((c) => c.instanceId === newInstanceId)!
        .definitionId
    ).toBe("BSTH03-転醒R01(A)");
    const alice = after.players.find((p) => p.id === "alice")!;
    // reserve 4 + 2(returned) - 3(paid) = 3、trash +3。
    expect(alice.reserveNormalCoreCount).toBe(3);
    expect(alice.trashNormalCoreCount).toBe(3);
  });

  it("mode:summon: 他フィールドカードからの支払いを finalization 後も保持する", () => {
    const baseA = getDef("BSTH03-転醒R01(A)")!;
    const payerDef: CardDefinition = {
      ...baseA,
      cardNo: "RR-PAYER",
      symbolColors: [],
    };
    const synthMap = new Map(defMap);
    synthMap.set("RR-PAYER", payerDef);
    const getDef2 = (id: string) => synthMap.get(id);
    const reborn = rebornInstanceOnField();
    const payer = createCardInstance(payerDef, {
      instanceId: "rr-payer",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const state: GameState = {
      ...reborn,
      cardInstances: [...reborn.cardInstances, payer],
    };
    const pendingState = executeReverseRebirth(
      state,
      "alice",
      { kind: "reverse_rebirth", mode: "summon" },
      "nx-1",
      getDef2
    );
    expect(pendingState.pendingReverseRebirthSummon!.costToPay).toBe(3);

    const after = resolveReverseRebirth(pendingState, getDef2, {
      summonPaymentSources: [
        { kind: "card", instanceId: "rr-payer", amount: 3 },
      ],
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "rr-payer")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      after.players.find((p) => p.id === "alice")?.trashNormalCoreCount
    ).toBe(3);
  });

  it("training は reserve 不足時にも返却後 reserve と場のコアを支払い候補にして pending を解決する", () => {
    const baseA = getDef("BSTH03-転醒R01(A)")!;
    const payerDef: CardDefinition = {
      ...baseA,
      cardNo: "RR-TRAINING-PAYER",
      symbolColors: [],
    };
    const synthMap = new Map(defMap);
    synthMap.set(payerDef.cardNo, payerDef);
    const getDef2 = (id: string) => synthMap.get(id);
    const reborn = rebornInstanceOnField();
    const payer = createCardInstance(payerDef, {
      instanceId: "rr-training-payer",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...reborn,
      players: reborn.players.map((player) =>
        player.id === "alice"
          ? { ...player, reserveNormalCoreCount: 0 }
          : player
      ),
      cardInstances: [...reborn.cardInstances, payer],
    };
    const pendingState = executeReverseRebirth(
      state,
      "alice",
      { kind: "reverse_rebirth", mode: "summon" },
      "nx-1",
      getDef2
    );
    expect(pendingState.pendingReverseRebirthSummon?.costToPay).toBe(3);

    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef2,
    }).find((candidate) => candidate.kind === "resolve_reverse_rebirth_summon");
    expect(action).toBeDefined();
    if (!action) return;

    const inputNode = createActionInputDecisionNode(pendingState, action, {
      getCardDefinitionById: getDef2,
    });
    const input = inputNode?.choices.find((choice) => {
      const sources = choice.applyOptions?.summonPaymentSources ?? [];
      return (
        sources.some(
          (source) => source.kind === "reserve" && source.amount === 2
        ) &&
        sources.some(
          (source) =>
            source.kind === "card" &&
            source.instanceId === "rr-training-payer" &&
            source.amount === 1
        )
      );
    });
    expect(input).toBeDefined();
    if (!input) return;

    const after = applyLegalAction({
      state: pendingState,
      action,
      getCardDefinitionById: getDef2,
      ...input.applyOptions,
    }).state;
    expect(after.pendingReverseRebirthSummon).toBeNull();
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === "rr-training-payer"
      )?.normalCoreCount
    ).toBe(0);
    expect(
      after.cardInstances.some(
        (card) => card.definitionId === "BSTH03-転醒R01(A)"
      )
    ).toBe(true);
  });

  it("training は逆転醒の支払いと維持コア配置の大きな直積を逐次決定へ分解する", () => {
    const baseA = getDef("BSTH03-転醒R01(A)")!;
    const payerDef: CardDefinition = {
      ...baseA,
      cardNo: "RR-WIDE-TRAINING-PAYER",
      symbolColors: [],
    };
    const definitions = new Map(defMap);
    definitions.set(payerDef.cardNo, payerDef);
    const getDef2 = (id: string) => definitions.get(id);
    const payers = Array.from({ length: 12 }, (_, index) =>
      createCardInstance(payerDef, {
        instanceId: `rr-wide-payer-${index}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const reborn = rebornInstanceOnField();
    let current = executeReverseRebirth(
      {
        ...reborn,
        players: reborn.players.map((player) =>
          player.id === "alice"
            ? { ...player, reserveNormalCoreCount: 0 }
            : player
        ),
        cardInstances: [...reborn.cardInstances, ...payers],
      },
      "alice",
      { kind: "reverse_rebirth", mode: "summon" },
      "nx-1",
      getDef2
    );
    const action = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef2,
    }).find((candidate) => candidate.kind === "resolve_reverse_rebirth_summon");
    expect(action).toBeDefined();
    if (!action) return;

    const localTrainingEngine: Engine = {
      ...trainingEngine,
      cards: [...expanded, payerDef],
      getCardDefinitionById: getDef2,
      lookups: {
        ...trainingEngine.lookups,
        getCardDefinitionById: getDef2,
      },
    };
    const options = {
      getCardDefinitionById: getDef2,
      maxGeneratedChoices: 1024,
    };
    let node = createActionInputDecisionNode(current, action, options);
    expect(node?.truncated).toBe(false);
    expect(
      node?.choices.some(
        (choice) =>
          choice.systemAction?.kind === "select_factored_zone_selection" &&
          "reverseRebirthPaymentCandidateIndex" in choice.systemAction
      )
    ).toBe(true);

    for (let step = 0; step < 40; step++) {
      expect(node).toBeDefined();
      expect(node?.truncated).toBe(false);
      const choice = node?.choices[0];
      expect(choice).toBeDefined();
      if (!node || !choice) return;
      current = applyTrainingDecisionChoice(
        current,
        node,
        choice,
        localTrainingEngine
      );
      if (current.pendingReverseRebirthSummon === null) break;
      node = getNextTrainingDecision(current, localTrainingEngine, options);
    }

    expect(current.pendingReverseRebirthSummon).toBeNull();
    expect(
      current.cardInstances.some(
        (card) => card.definitionId === "BSTH03-転醒R01(A)"
      )
    ).toBe(true);
  });

  it("mode:summon: 軽減は自身のシンボルでは効かない（自身を供給側から除外）", () => {
    const baseA = getDef("BSTH03-転醒R01(A)")!;
    // 逆転醒する表面 def: spirit・cost3・軽減 red×2・自身シンボル red。
    const synthFront: CardDefinition = {
      ...baseA,
      cardNo: "SYN-RED-A",
      printedCategory: "spirit",
      cost: 3,
      reductionSymbols: ["red", "red"],
      symbolColors: ["red"],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
    };
    // 別の軽減供給ネクサス（red シンボル1つ）。
    const reducer: CardDefinition = {
      ...baseA,
      cardNo: "REDUCER-RED",
      symbolColors: ["red"],
    };
    const synthMap = new Map(defMap);
    synthMap.set("SYN-RED-A", synthFront);
    synthMap.set("REDUCER-RED", reducer);
    const getDef2 = (id: string) => synthMap.get(id);

    const rrBase = createCardInstance(baseA, {
      instanceId: "sp-red",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 0,
    });
    const rrInst = {
      ...rrBase,
      definitionId: "SYN-RED-B",
      originalDefinitionId: "SYN-RED-A",
    };
    const reducerInst = createCardInstance(reducer, {
      instanceId: "nx-red",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 1,
    });
    const base: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [rrInst, reducerInst],
    });
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, reserveNormalCoreCount: 5 } : p
      ),
    };

    const pendingState = executeReverseRebirth(
      state,
      "alice",
      { kind: "reverse_rebirth", mode: "summon" },
      "sp-red",
      getDef2
    );
    // 軽減供給は REDUCER(red 1) のみ（自身 red は除外）→ 軽減 1 → コスト 3-1=2。
    // 自身を数えていれば red 2 → 軽減 2 → コスト 1 になってしまう。
    expect(pendingState.pendingReverseRebirthSummon!.costToPay).toBe(2);

    const after = resolveReverseRebirth(pendingState, getDef2); // auto-pay 2
    const alice = after.players.find((p) => p.id === "alice")!;
    const newInstanceId = reverseRebirthNewInstanceId(
      pendingState.pendingReverseRebirthSummon!
    );
    expect(
      after.cardInstances.find((c) => c.instanceId === newInstanceId)!
        .definitionId
    ).toBe("SYN-RED-A");
    expect(alice.reserveNormalCoreCount).toBe(5 - 2);
    expect(alice.trashNormalCoreCount).toBe(2);
  });

  it("mode:summon: 表面の召喚時効果を通常 summon trigger としてキューする", () => {
    const baseA = getDef("BSTH03-転醒R01(A)")!;
    const synthFront: CardDefinition = {
      ...baseA,
      cardNo: "SYN-SUMMON-TRIGGER-A",
      printedCategory: "spirit",
      cost: 0,
      reductionSymbols: [],
      symbolColors: ["red"],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
      textLines: ["Lv1『このスピリットの召喚時』", "自分はカウント+1する。"],
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
          textRef: [0, 1],
        },
      ],
    };
    const synthMap = new Map(defMap);
    synthMap.set("SYN-SUMMON-TRIGGER-A", synthFront);
    const getDef2 = (id: string) => synthMap.get(id);
    const rrBase = createCardInstance(baseA, {
      instanceId: "sp-trigger",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 0,
    });
    const rrInst = {
      ...rrBase,
      definitionId: "SYN-SUMMON-TRIGGER-B",
      originalDefinitionId: "SYN-SUMMON-TRIGGER-A",
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [rrInst],
    });

    const pendingState = executeReverseRebirth(
      state,
      "alice",
      { kind: "reverse_rebirth", mode: "summon" },
      "sp-trigger",
      getDef2
    );
    const newInstanceId = reverseRebirthNewInstanceId(
      pendingState.pendingReverseRebirthSummon!
    );
    const after = resolveReverseRebirth(pendingState, getDef2, {
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        synthFront,
      ]),
    });

    expect(after.pendingTriggeredEffects).toHaveLength(1);
    expect(after.pendingTriggeredEffects[0]).toMatchObject({
      eventKind: "summon",
      relatedInstanceId: newInstanceId,
    });
    expect(
      after.pendingTriggeredEffects.some(
        (pending) =>
          pending.eventKind === "leave_field" &&
          pending.relatedInstanceId === "sp-trigger"
      )
    ).toBe(false);
  });
});

describe("逆転醒 reverse_rebirth pattern2(summon, withoutCost)", () => {
  it("withoutCost: B面ネクサスを裏返して配置（維持コア0）。def=A面・コア→リザーブ・count 不変・新 instance", () => {
    const reborn = rebornInstanceOnField();
    const bInst = reborn.cardInstances.find((c) => c.instanceId === "nx-1")!;
    expect(bInst.definitionId).toBe("BSTH03-転醒R01(B)");
    const coresOnCard = bInst.normalCoreCount; // 2
    const reserveBefore = reborn.players.find(
      (p) => p.id === "alice"
    )!.reserveNormalCoreCount;
    const countBefore = reborn.players.find(
      (p) => p.id === "alice"
    )!.countValue;

    const pendingState = executeReverseRebirth(
      reborn,
      "alice",
      { kind: "reverse_rebirth", mode: "summon", withoutCost: true },
      "nx-1",
      getDef
    );
    expect(pendingState.pendingReverseRebirthSummon!.costToPay).toBe(0);

    const newInstanceId = reverseRebirthNewInstanceId(
      pendingState.pendingReverseRebirthSummon!
    );
    const after = resolveReverseRebirth(pendingState, getDef);
    expect(after.cardInstances.some((c) => c.instanceId === "nx-1")).toBe(
      false
    );
    const aInst = after.cardInstances.find(
      (c) => c.instanceId === newInstanceId
    )!;
    // A 面へ戻る（裏返して配置）。
    expect(aInst.definitionId).toBe("BSTH03-転醒R01(A)");
    expect(aInst.instanceId).toBe(newInstanceId);
    // BSTH03-転醒R01(A) は Lv1 requiredCores=0 → 維持コア0、コアは全てリザーブへ。
    expect(aInst.normalCoreCount).toBe(0);
    expect(
      after.players.find((p) => p.id === "alice")!.reserveNormalCoreCount
    ).toBe(reserveBefore + coresOnCard);
    // 逆転醒で count は不変（裁定 2026-06-14）。
    expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(
      countBefore
    );
  });

  it("withoutCost: 選択した維持コアを再配置し余剰はリザーブへ", () => {
    const baseA = getDef("BSTH03-転醒R01(A)")!;
    // synthetic 表面 def: spirit・Lv1 requiredCores=2。
    const synthFront: CardDefinition = {
      ...baseA,
      cardNo: "SYN-RR-A",
      printedCategory: "spirit",
      levelDefs: [
        { level: 1, requiredCores: 2, bp: 3000 },
        { level: 2, requiredCores: 3, bp: 5000 },
      ],
    };
    const synthMap = new Map(defMap);
    synthMap.set("SYN-RR-A", synthFront);
    const getDef2 = (id: string) => synthMap.get(id);

    // B 面 instance を場に（originalDefinitionId=SYN-RR-A）。コア4個。
    const baseInst = createCardInstance(baseA, {
      instanceId: "sp-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 4,
    });
    const inst = {
      ...baseInst,
      definitionId: "SYN-RR-B",
      originalDefinitionId: "SYN-RR-A",
    };
    const base: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst],
    });
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, reserveNormalCoreCount: 1 } : p
      ),
    };

    const pendingState = executeReverseRebirth(
      state,
      "alice",
      { kind: "reverse_rebirth", mode: "summon", withoutCost: true },
      "sp-1",
      getDef2
    );
    const newInstanceId = reverseRebirthNewInstanceId(
      pendingState.pendingReverseRebirthSummon!
    );
    const after = resolveReverseRebirth(pendingState, getDef2, {
      summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 2 }],
    });

    const aInst = after.cardInstances.find(
      (c) => c.instanceId === newInstanceId
    )!;
    expect(aInst.definitionId).toBe("SYN-RR-A");
    // 維持コア=2 を再配置。reserveAfterReturn = 1 + 4 = 5 → placed=2 → reserve=3。
    expect(aInst.normalCoreCount).toBe(2);
    expect(aInst.minimumRequiredCores).toBe(2);
    expect(aInst.exhaustState).toBe("recovered");
    expect(
      after.players.find((p) => p.id === "alice")!.reserveNormalCoreCount
    ).toBe(3);
  });

  it("withoutCost: 維持コア配置を明示選択（reserve_normal）して再配置", () => {
    const baseA = getDef("BSTH03-転醒R01(A)")!;
    const synthFront: CardDefinition = {
      ...baseA,
      cardNo: "SYN-PL-A",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 2, bp: 3000 }],
    };
    const synthMap = new Map(defMap);
    synthMap.set("SYN-PL-A", synthFront);
    const getDef2 = (id: string) => synthMap.get(id);
    const baseInst = createCardInstance(baseA, {
      instanceId: "sp-pl",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 4,
    });
    const inst = {
      ...baseInst,
      definitionId: "SYN-PL-B",
      originalDefinitionId: "SYN-PL-A",
    };
    const base: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst],
    });
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, reserveNormalCoreCount: 1 } : p
      ),
    };
    const pendingState = executeReverseRebirth(
      state,
      "alice",
      { kind: "reverse_rebirth", mode: "summon", withoutCost: true },
      "sp-pl",
      getDef2
    );
    const newInstanceId = reverseRebirthNewInstanceId(
      pendingState.pendingReverseRebirthSummon!
    );
    const after = resolveReverseRebirth(pendingState, getDef2, {
      summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 2 }],
    });
    const aInst = after.cardInstances.find(
      (c) => c.instanceId === newInstanceId
    )!;
    expect(aInst.normalCoreCount).toBe(2);
    expect(
      after.players.find((p) => p.id === "alice")!.reserveNormalCoreCount
    ).toBe(3);
  });

  it("withoutCost: 明示配置 payload が維持コア未満なら拒否する", () => {
    const baseA = getDef("BSTH03-転醒R01(A)")!;
    const synthFront: CardDefinition = {
      ...baseA,
      cardNo: "SYN-PL-VALIDATE-A",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 2, bp: 3000 }],
    };
    const synthMap = new Map(defMap);
    synthMap.set("SYN-PL-VALIDATE-A", synthFront);
    const getDef2 = (id: string) => synthMap.get(id);
    const baseInst = createCardInstance(baseA, {
      instanceId: "sp-pl-validate",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 4,
    });
    const inst = {
      ...baseInst,
      definitionId: "SYN-PL-VALIDATE-B",
      originalDefinitionId: "SYN-PL-VALIDATE-A",
    };
    const base: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst],
    });
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, reserveNormalCoreCount: 1 } : p
      ),
    };
    const pendingState = executeReverseRebirth(
      state,
      "alice",
      { kind: "reverse_rebirth", mode: "summon", withoutCost: true },
      "sp-pl-validate",
      getDef2
    );

    expect(() =>
      resolveReverseRebirth(pendingState, getDef2, {
        summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      })
    ).toThrow(/below minimum/);
  });

  it("withoutCost: 維持コア不足なら召喚不成立（盤面不変）", () => {
    const baseA = getDef("BSTH03-転醒R01(A)")!;
    const synthFront: CardDefinition = {
      ...baseA,
      cardNo: "SYN-RR2-A",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 2, bp: 3000 }],
    };
    const synthMap = new Map(defMap);
    synthMap.set("SYN-RR2-A", synthFront);
    const getDef2 = (id: string) => synthMap.get(id);

    const baseInst = createCardInstance(baseA, {
      instanceId: "sp-2",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 0,
    });
    const inst = {
      ...baseInst,
      definitionId: "SYN-RR2-B",
      originalDefinitionId: "SYN-RR2-A",
    };
    const base: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst],
    });
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, reserveNormalCoreCount: 1 } : p
      ),
    };

    const after = executeReverseRebirth(
      state,
      "alice",
      { kind: "reverse_rebirth", mode: "summon", withoutCost: true },
      "sp-2",
      getDef2
    );

    // reserveAfterReturn = 1 + 0 = 1 < min 2 → 不成立、pending 非生成・B 面のまま。
    const stillB = after.cardInstances.find((c) => c.instanceId === "sp-2")!;
    expect(stillB.definitionId).toBe("SYN-RR2-B");
    expect(after.pendingReverseRebirthSummon).toBeNull();
    expect(after.log.some((l) => l.includes("summon-core-deficit"))).toBe(true);
  });
});

// ============================================================
// 実カードの逆転醒トリガー（game_event）→ reverse_rebirth summon 一括消化
// BSTH06-転醒R01(B) 地霊殿 / BSTH07-転醒R01(B) 命蓮寺
// ============================================================

/** B 面ネクサスを場に置いて front を originalDefinitionId に張る。 */
function backNexusOnField(backDefId: string, frontDefId: string): GameState {
  const backDef = getDef(backDefId)!;
  const base = createCardInstance(backDef, {
    instanceId: "nx-rr",
    ownerPlayerId: "alice",
    zone: "field",
    zoneRoleName: "nexus",
    normalCoreCount: 0,
  });
  const inst = { ...base, originalDefinitionId: frontDefId };
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [inst],
  });
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === "alice" ? { ...p, reserveNormalCoreCount: 5 } : p
    ),
  };
}

describe("BSTH06-転醒R01(B) 地霊殿 [5,6] 逆転醒（地霊コスト8召喚トリガー）", () => {
  const card = getDef("BSTH06-転醒R01(B)")!;

  it("[5,6] は game_event:summon(地霊/コスト8) → reverse_rebirth summon で stub 解消", () => {
    const eff = card.effects!.find((e) =>
      e.steps.some((s) => s.action?.kind === "reverse_rebirth")
    )!;
    expect(eff.stub).toBeUndefined();
    expect(eff.timing).toMatchObject({
      kind: "game_event",
      player: "self",
      event: "summon",
    });
    expect(eff.timing).toMatchObject({
      triggerFilter: { tribes: ["地霊"], minCost: 8, maxCost: 8 },
    });
  });

  it("効果実行で B 面ネクサスが A 面(BSTH06-転醒R01(A))へ裏返って配置される（コスト3支払い）", () => {
    const state = backNexusOnField("BSTH06-転醒R01(B)", "BSTH06-転醒R01(A)");
    const eff = card.effects!.find((e) =>
      e.steps.some((s) => s.action?.kind === "reverse_rebirth")
    )!;
    const pendingState = executeEffect({
      chainId: "test:reverse-rebirth:1958",
      state,
      effect: eff,
      sourceInstanceId: "nx-rr",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(pendingState.pendingReverseRebirthSummon).not.toBeNull();
    // BSTH06-転醒R01(A): cost3・軽減 [green,red]・自身のみ → 軽減0 → コスト3。
    expect(pendingState.pendingReverseRebirthSummon!.costToPay).toBe(3);

    const newInstanceId = reverseRebirthNewInstanceId(
      pendingState.pendingReverseRebirthSummon!
    );
    const after = resolveReverseRebirth(pendingState, getDef); // auto-pay 3
    const nx = after.cardInstances.find((c) => c.instanceId === newInstanceId)!;
    expect(nx.definitionId).toBe("BSTH06-転醒R01(A)");
    const alice = after.players.find((p) => p.id === "alice")!;
    // reserve 5 - 3(paid) = 2、trash +3。維持コア 0。
    expect(alice.reserveNormalCoreCount).toBe(2);
    expect(alice.trashNormalCoreCount).toBe(3);
    expect(after.pendingReverseRebirthSummon).toBeNull();
  });
});

describe("BSTH03-転醒R01(B) 玄爺 [5,6] 逆転醒（自分のカウント減少トリガー）", () => {
  const card = getDef("BSTH03-転醒R01(B)")!;

  it("[5,6] は game_event:count_decrease → reverse_rebirth summon で stub 解消", () => {
    const eff = card.effects!.find((e) =>
      e.steps.some((s) => s.action?.kind === "reverse_rebirth")
    )!;
    expect(eff.stub).toBeUndefined();
    expect(eff.timing).toMatchObject({
      kind: "game_event",
      player: "self",
      event: "count_decrease",
    });
  });

  it("効果実行で B 面ネクサスが A 面(BSTH03-転醒R01(A))へ裏返って配置される（コスト3支払い）", () => {
    const state = backNexusOnField("BSTH03-転醒R01(B)", "BSTH03-転醒R01(A)");
    const eff = card.effects!.find((e) =>
      e.steps.some((s) => s.action?.kind === "reverse_rebirth")
    )!;
    const pendingState = executeEffect({
      chainId: "test:reverse-rebirth:2003",
      state,
      effect: eff,
      sourceInstanceId: "nx-rr",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(pendingState.pendingReverseRebirthSummon).not.toBeNull();
    // BSTH03-転醒R01(A): cost3・軽減 [green,red]・自身のみ → 軽減0 → コスト3。
    expect(pendingState.pendingReverseRebirthSummon!.costToPay).toBe(3);

    const newInstanceId = reverseRebirthNewInstanceId(
      pendingState.pendingReverseRebirthSummon!
    );
    const after = resolveReverseRebirth(pendingState, getDef); // auto-pay 3
    const nx = after.cardInstances.find((c) => c.instanceId === newInstanceId)!;
    expect(nx.definitionId).toBe("BSTH03-転醒R01(A)");
    const alice = after.players.find((p) => p.id === "alice")!;
    // reserve 5 - 3(paid) = 2、trash +3。維持コア 0。
    expect(alice.reserveNormalCoreCount).toBe(2);
    expect(alice.trashNormalCoreCount).toBe(3);
    expect(after.pendingReverseRebirthSummon).toBeNull();
  });
});

describe("BSTH07-転醒R01(B) 命蓮寺 [5,6] 逆転醒（星蓮/闘神アタックトリガー）", () => {
  const card = getDef("BSTH07-転醒R01(B)")!;

  it("[5,6] は game_event:attack(星蓮/闘神) → reverse_rebirth summon で stub 解消", () => {
    const eff = card.effects!.find((e) =>
      e.steps.some((s) => s.action?.kind === "reverse_rebirth")
    )!;
    expect(eff.stub).toBeUndefined();
    expect(eff.timing).toMatchObject({
      kind: "game_event",
      player: "self",
      event: "attack",
    });
    expect(eff.timing).toMatchObject({
      triggerFilter: { tribes: ["星蓮", "闘神"] },
    });
  });

  it("効果実行で B 面ネクサスが A 面(BSTH07-転醒R01(A))へ裏返って配置される（コスト3支払い）", () => {
    const state = backNexusOnField("BSTH07-転醒R01(B)", "BSTH07-転醒R01(A)");
    const eff = card.effects!.find((e) =>
      e.steps.some((s) => s.action?.kind === "reverse_rebirth")
    )!;
    const pendingState = executeEffect({
      chainId: "test:reverse-rebirth:2051",
      state,
      effect: eff,
      sourceInstanceId: "nx-rr",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(pendingState.pendingReverseRebirthSummon).not.toBeNull();
    // BSTH07-転醒R01(A): cost3・軽減 [blue,blue]・自身のみ → 軽減0 → コスト3。
    expect(pendingState.pendingReverseRebirthSummon!.costToPay).toBe(3);

    const newInstanceId = reverseRebirthNewInstanceId(
      pendingState.pendingReverseRebirthSummon!
    );
    const after = resolveReverseRebirth(pendingState, getDef);
    const nx = after.cardInstances.find((c) => c.instanceId === newInstanceId)!;
    expect(nx.definitionId).toBe("BSTH07-転醒R01(A)");
    const alice = after.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(2);
    expect(alice.trashNormalCoreCount).toBe(3);
    expect(after.pendingReverseRebirthSummon).toBeNull();
  });
});
