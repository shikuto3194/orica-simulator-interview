/**
 * BSTH02.7-TX01(A)「グランギニョル座の怪人」effects[0] 後半:
 * 「戻したとき、この効果発揮後、このカードの【転醒】を発揮できる」(ENGINE-magic-rebirth-from-hand)。
 *
 * 手札にあるマジックカードが『転醒』する型 (公式先例BS55-TCP07(A)氷刃血解)。通常の転醒
 * (executeRebirth: 場のカードの flip) とは異なり、対象カードは手札/手元にあるため
 * フィールドへの新規配置を伴う。専用関数 executeMagicRebirthFromHand
 * (structured-card-replacement.ts) が、executeRebirth のゾーン判定から委譲される形で
 * これを処理する。
 *
 * DSL 合成: bounce(id:"bounce") → after_triggers + stepCondition:ref_succeeded(bounce) +
 * executionMode:optional で pay_cost(3) → connector:conditional_cost で rebirth(maxCount:9)。
 * bsft01-tr-rebirth-permission-window.test.ts と同型 (after_triggers+optional は
 * pendingStepOptionalChoice を経由する)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  executeBattleResolution,
  flushPendingLeaves,
  resolveBraveLeaveChoice,
  runStateBasedActions,
} from "../src";
import {
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
} from "../src/effect/structured-effect-registrations";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { executeRebirth } from "../src/effect/structured-card-replacement";
import { moveCardZone } from "../src/core/core-system";
import { getLegalActions } from "../src/legal/legal-actions";
import type { ActiveAttack, CardDefinition, GameState } from "../src/model";

function buildLookups(extraDefs: readonly CardDefinition[] = []) {
  const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
  const map = new Map([...expanded, ...extraDefs].map((d) => [d.cardNo, d]));
  return {
    getCardDefinitionById: (id: string) => map.get(id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(expanded),
  };
}

const ALICE = "alice";
const BOB = "bob";

function makeOpponentSpiritDef(): CardDefinition {
  return {
    cardNo: "TEST-BSTH02-7-TX01-REBIRTH-OPP-SPIRIT",
    name: "テスト相手スピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function setup() {
  const opponentSpiritDef = makeOpponentSpiritDef();
  const lookups = buildLookups([opponentSpiritDef]);
  const TX01 = lookups.getCardDefinitionById("BSTH02.7-TX01(A)")!;
  const opponentSpirit = createCardInstance(opponentSpiritDef, {
    instanceId: "opp-spirit-1",
    ownerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 1,
  });
  const handCard = createCardInstance(TX01, {
    instanceId: "tx01-hand-1",
    ownerPlayerId: ALICE,
    zone: "hand",
  });
  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [opponentSpirit, handCard],
  });
  const effect = TX01.effects!.find(
    (e) => Array.isArray(e.textRef) && e.textRef[0] === 0
  )!;
  return { lookups, TX01, opponentSpirit, handCard, state, effect };
}

function moveDeclaredHandMagicToInUse(
  state: GameState,
  sourceInstanceId: string
): GameState {
  return moveCardZone(state, sourceInstanceId, "in_use");
}

function withOpenBattle(
  state: GameState,
  attackerInstanceId: string,
  attackId = "attack:tx01-regression"
): GameState {
  const activeAttack: ActiveAttack = {
    attackId,
    primaryEntityId: "tx01-regression-attacker",
    participantEntityIds: ["tx01-regression-attacker"],
    groupMode: "single",
    target: { kind: "player", playerId: ALICE },
    blockAssignments: [
      {
        participantEntityId: "tx01-regression-attacker",
        blockedByEntityIds: [],
      },
    ],
    symbolResolutionOrder: ["tx01-regression-attacker"],
    flashBeforeBlockCompleted: true,
    flashAfterBlockCompleted: false,
    flashWindowState: null,
  };
  return {
    ...state,
    activePlayerId: BOB,
    step: "attack",
    window: "declare_attack",
    activeAttack,
    battleEntities: [
      {
        entityId: "tx01-regression-attacker",
        resolvedBp: 3000,
        attackState: "attacking",
        resolvedSymbols: ["red"],
        memberInstanceIds: [attackerInstanceId],
      },
    ],
  };
}

describe("BSTH02.7-TX01(A) ENGINE-magic-rebirth-from-hand", () => {
  it.each([0, 3])(
    "リザーブ%d: 単一・複数のフィールド支払元ともHUDで支払って転醒・配置できる",
    (reserve) => {
      const { lookups, state: base, effect, handCard } = setup();
      const donor = createCardInstance(makeOpponentSpiritDef(), {
        instanceId: "tx01-payment-source",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 3,
      });
      const state: GameState = {
        ...base,
        cardInstances: [...base.cardInstances, donor],
        players: base.players.map((p) =>
          p.id === ALICE
            ? {
                ...p,
                reserveNormalCoreCount: reserve,
                reserveSoulCoreCount: 0,
                trashSoulCoreCount: 1,
                soulCoreLocation: { kind: "trash" },
              }
            : p
        ),
      };
      const afterBody = executeEffect({
        chainId: "test:bsth02-7-tx01-magic-rebirth-from-hand:163",
        state: moveDeclaredHandMagicToInUse(state, handCard.instanceId),
        effect,
        effectIndex: 0,
        sourceInstanceId: handCard.instanceId,
        actingPlayerId: ALICE,
        ...lookups,
        activationZone: "hand",
      });
      const execute = getLegalActions({
        state: afterBody,
        actingPlayerId: ALICE,
        ...lookups,
      }).find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "execute"
      )!;
      expect(execute?.can).toBe(true);
      const pending = applyLegalAction({
        state: afterBody,
        action: execute,
        ...lookups,
      }).state;
      expect(pending.pendingCoreSourceAllocation).toMatchObject({
        requiredTotal: 3,
        candidates: expect.arrayContaining([
          {
            instanceId: donor.instanceId,
            available: 3,
            normalAvailable: 3,
            hasSoulCore: false,
          },
        ]),
      });
      expect(
        pending.cardInstances.find((c) => c.instanceId === donor.instanceId)
          ?.normalCoreCount
      ).toBe(3);
      expect(
        pending.cardInstances.find((c) => c.instanceId === handCard.instanceId)
          ?.definitionId
      ).toBe("BSTH02.7-TX01(A)");
      const pay = getLegalActions({
        state: pending,
        actingPlayerId: ALICE,
        ...lookups,
      }).find((a) => a.kind === "resolve_core_source_allocation")!;
      const paid = applyLegalAction({
        state: pending,
        action: pay,
        ...lookups,
        coreSourceAllocations: { [donor.instanceId]: 3 },
      }).state;
      expect(paid.pendingCoreSourceAllocation).toBeNull();
      expect(
        paid.players.find((p) => p.id === ALICE)?.reserveNormalCoreCount
      ).toBe(reserve);
      expect(
        paid.players.find((p) => p.id === ALICE)?.trashNormalCoreCount
      ).toBe(3);
      expect(
        paid.cardInstances.find((c) => c.instanceId === donor.instanceId)
          ?.normalCoreCount
      ).toBe(0);
      expect(paid.pendingCoreDistribution?.sourceAvailable?.trash).toBe(1);
      const place = getLegalActions({
        state: paid,
        actingPlayerId: ALICE,
        ...lookups,
      }).find((a) => a.kind === "resolve_pending_core_distribution")!;
      const done = applyLegalAction({
        state: paid,
        action: place,
        ...lookups,
        coreDistributionAllocations: { [handCard.instanceId]: 1 },
        coreDistributionSourceAllocations: { trash: 1 },
      }).state;
      expect(
        done.cardInstances.find((c) => c.instanceId === handCard.instanceId)
      ).toMatchObject({
        definitionId: "BSTH02.7-TX01(B)",
        zone: "field",
        normalCoreCount: 1,
      });
      expect(done.players.find((p) => p.id === ALICE)?.countValue).toBe(1);
    }
  );

  it("effects[0] steps: bounce → after_triggers+ref_succeeded(bounce)+optional pay_cost(3) → conditional_cost rebirth(maxCount:9) → trash上限1+field/reserve core_distribute → deferTo:battle_end end_attack_step", () => {
    const { effect } = setup();
    expect(effect.stub).toBeUndefined();
    expect(effect.steps).toHaveLength(5);
    expect(effect.steps[0]!.id).toBe("bounce");
    expect(effect.steps[1]).toMatchObject({
      id: "rebirth_pay",
      connector: "after_triggers",
      stepCondition: { kind: "ref_succeeded", stepId: "bounce" },
      executionMode: "optional",
      action: { kind: "pay_cost", amount: 3 },
    });
    expect(effect.steps[2]).toEqual({
      id: "rebirth",
      connector: "conditional_cost",
      action: {
        kind: "rebirth",
        maxCount: 9,
        allowPostRebirthCorePlacementForLvDeficit: true,
      },
    });
    expect(effect.steps[3]).toEqual({
      connector: "sequential",
      condition: [{ kind: "self_state", state: "on_field" }],
      action: {
        kind: "core_distribute",
        from: {
          kind: "field_reserve_and_trash_self",
          trashCoreLimit: 1,
          trashCoreKind: "normal_only",
        },
        to: { kind: "source_card" },
        amount: "all",
        mode: "player_choice",
        minTotal: 1,
      },
    });
    expect(effect.steps[4]).toEqual({
      connector: "sequential",
      condition: [{ kind: "self_state", state: "on_field" }],
      deferTo: "battle_end",
      action: { kind: "end_attack_step" },
    });
  });

  it("bounce 成功 → 転醒許可窓の pendingStepOptionalChoice が立つ", () => {
    const { lookups, state, effect, handCard } = setup();
    const inUseState = moveDeclaredHandMagicToInUse(state, handCard.instanceId);
    const afterBody = executeEffect({
      chainId: "test:bsth02-7-tx01-magic-rebirth-from-hand:300",
      state: inUseState,
      effect,
      sourceInstanceId: handCard.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      activationZone: "hand",
    });
    const pending = afterBody.pendingStepOptionalChoice;
    expect(pending).not.toBeNull();
    expect(pending!.sourceInstanceId).toBe(handCard.instanceId);
    expect(
      afterBody.cardInstances.find((c) => c.instanceId === handCard.instanceId)
        ?.zone
    ).toBe("in_use");
    expect(pending!.prompt).toMatchObject({
      label: "3コスト支払う",
      question: "3コスト支払いますか？",
    });
  });

  it("合体契約スピリットを戻す場合、ブレイヴ分離選択と魂状態置換選択を保持する", () => {
    const lookups = buildLookups();
    const TX01 = lookups.getCardDefinitionById("BSTH02.7-TX01(A)")!;
    const contractDef = lookups.getCardDefinitionById("BSGE01-CX01")!;
    const braveDef = lookups.getCardDefinitionById("BSGE01-C05")!;
    const contract = createCardInstance(contractDef, {
      instanceId: "ge-contract-host",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["ge-brave"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "ge-brave",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
      attachedToInstanceId: contract.instanceId,
    });
    const handCard = createCardInstance(TX01, {
      instanceId: "tx01-hand-combined",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [contract, brave, handCard],
      playerOverrides: [{}, { contractCardNo: contractDef.cardNo }],
    });
    const effect = TX01.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 0
    )!;
    const inUseState = moveDeclaredHandMagicToInUse(state, handCard.instanceId);

    const pendingBrave = executeEffect({
      chainId: "test:bsth02-7-tx01-magic-rebirth-from-hand:356",
      state: inUseState,
      effect,
      sourceInstanceId: handCard.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      activationZone: "hand",
    });

    expect(pendingBrave.pendingBraveLeaveChoice).toMatchObject({
      choosingPlayerId: BOB,
      hostInstanceId: contract.instanceId,
      braveInstanceIds: [brave.instanceId],
      leaveKind: "bounce",
      leaveDestination: { zone: "hand" },
    });
    expect(pendingBrave.pendingSoulStateReplacement).toMatchObject({
      choosingPlayerId: BOB,
      cardInstanceId: contract.instanceId,
      originalLeaveKind: "bounce",
    });
    expect(
      pendingBrave.cardInstances.find(
        (c) => c.instanceId === contract.instanceId
      )?.pendingLeaveKind
    ).toBe("bounce");
    expect(
      pendingBrave.cardInstances.find(
        (c) => c.instanceId === contract.instanceId
      )?.zone
    ).toBe("field");

    const afterKeepBrave = resolveBraveLeaveChoice(
      pendingBrave,
      "keep",
      { reserve: 1 },
      lookups.getCardDefinitionById
    );
    const pendingSoul = flushPendingLeaves(
      afterKeepBrave,
      lookups.getCardDefinitionById
    );

    expect(pendingSoul.pendingBraveLeaveChoice).toBeNull();
    expect(pendingSoul.pendingSoulStateReplacement).toMatchObject({
      choosingPlayerId: BOB,
      cardInstanceId: contract.instanceId,
      originalLeaveKind: "bounce",
    });
    expect(
      pendingSoul.cardInstances.find((c) => c.instanceId === brave.instanceId)
        ?.attachedToInstanceId
    ).toBeNull();
    expect(
      pendingSoul.cardInstances.find((c) => c.instanceId === brave.instanceId)
        ?.normalCoreCount
    ).toBe(1);
  });

  it("転醒許可窓を execute → B面でフィールドへ配置され、trash上限1+field/reserve のコア配置HUDが開く", () => {
    const {
      lookups,
      state: baseState,
      effect,
      handCard,
      opponentSpirit,
    } = setup();
    const state: GameState = {
      ...baseState,
      players: baseState.players.map((player) =>
        player.id === ALICE
          ? {
              ...player,
              voidNormalCoreCount: 10,
              trashNormalCoreCount: 3,
            }
          : player
      ),
    };
    const inUseState = moveDeclaredHandMagicToInUse(state, handCard.instanceId);
    const afterBody = executeEffect({
      chainId: "test:bsth02-7-tx01-magic-rebirth-from-hand:437",
      state: inUseState,
      effect,
      sourceInstanceId: handCard.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      activationZone: "hand",
    });
    const pending = afterBody.pendingStepOptionalChoice!;

    const afterExecute = applyLegalAction({
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
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
    }).state;

    // 相手スピリットは手札へ戻っている (effects[0] 前段の bounce)。
    expect(
      afterExecute.cardInstances.find(
        (c) => c.instanceId === opponentSpirit.instanceId
      )!.zone
    ).toBe("hand");

    // 転醒後: B面へフィールド配置。ここではまだ印字のコア配置HUD待ちなので0コア。
    const flippedBeforePlacement = afterExecute.cardInstances.find(
      (c) => c.instanceId === handCard.instanceId
    )!;
    expect(flippedBeforePlacement.zone).toBe("field");
    expect(flippedBeforePlacement.definitionId).toBe("BSTH02.7-TX01(B)");
    expect(flippedBeforePlacement.originalDefinitionId).toBe(
      "BSTH02.7-TX01(A)"
    );
    expect(flippedBeforePlacement.zoneRoleName).toBe("spirit");
    expect(flippedBeforePlacement.normalCoreCount).toBe(0);
    const aliceBeforePlacement = afterExecute.players.find(
      (p) => p.id === ALICE
    )!;
    expect(aliceBeforePlacement.countValue).toBe(0);
    expect(aliceBeforePlacement.voidNormalCoreCount).toBe(10);

    const corePending = afterExecute.pendingCoreDistribution!;
    expect(corePending).toMatchObject({
      fromKind: "any_movable",
      rebirthCompletion: {
        sourceInstanceId: handCard.instanceId,
        actingPlayerId: ALICE,
      },
      candidates: [
        {
          instanceId: handCard.instanceId,
          definitionId: "BSTH02.7-TX01(B)",
        },
      ],
      sourceAvailable: {
        reserve: 1,
        trash: 1,
      },
      sourceTotalAvailable: {
        reserve: 1,
        trash: 1,
      },
    });
    expect(corePending.allowedSources).toContainEqual({ kind: "reserve" });
    expect(corePending.allowedSources).toContainEqual({ kind: "trash" });
    expect(corePending.soulSourceAvailable?.trash).toBeUndefined();

    const coreAction = getLegalActions({
      state: afterExecute,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookups.getCardDefinitionById,
    }).find((action) => action.kind === "resolve_pending_core_distribution")!;

    const resolved = applyLegalAction({
      state: afterExecute,
      action: coreAction,
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
      coreDistributionAllocations: { [handCard.instanceId]: 1 },
      coreDistributionSourceAllocations: { trash: 1 },
    }).state;

    const flipped = resolved.cardInstances.find(
      (c) => c.instanceId === handCard.instanceId
    )!;
    expect(flipped.normalCoreCount).toBe(1);

    // カウント+1、コスト3(pay_cost) はtrashへ。維持コアはtrashから1個置いたので reserve は1残る。
    const alice = resolved.players.find((p) => p.id === ALICE)!;
    expect(alice.countValue).toBe(1);
    expect(alice.voidNormalCoreCount).toBe(9);
    expect(alice.reserveNormalCoreCount).toBe(1);
    expect(alice.trashNormalCoreCount).toBe(5);
    expect(alice.handCount).toBe(3);
  });

  it.each(["execute", "decline"] as const)(
    "実際のライフ減少誘発から転醒を%sし、バトル終了後のステップを確定する",
    (choice) => {
      const {
        lookups: baseLookups,
        state: base,
        handCard,
        opponentSpirit,
      } = setup();
      const lookups = {
        ...baseLookups,
        getRegisteredFieldCardEffectActions: () => [],
      };
      const battle = withOpenBattle(
        {
          ...base,
          turnNumber: 4,
          players: base.players.map((p) =>
            p.id === ALICE
              ? {
                  ...p,
                  reserveNormalCoreCount: 6,
                  trashNormalCoreCount: 3,
                }
              : p
          ),
        },
        opponentSpirit.instanceId
      );
      let state = executeBattleResolution({ state: battle, ...lookups }).state;
      const drainResponses = () => {
        for (let i = 0; i < 20; i++) {
          const actions = [ALICE, BOB].flatMap((actingPlayerId) =>
            getLegalActions({ state, actingPlayerId, ...lookups })
          );
          const response = actions.find(
            (a) =>
              a.can &&
              (a.kind === "resolve_pending_burst_check" ||
                a.kind === "pass_stack")
          );
          if (!response) return;
          state = applyLegalAction({
            state,
            action: response,
            ...lookups,
          }).state;
        }
        throw new Error("TX01 response loop did not settle");
      };
      const apply = (kind: string, extra = {}, selectedChoice?: string) => {
        drainResponses();
        const actions = getLegalActions({
          state,
          actingPlayerId: ALICE,
          ...lookups,
        });
        const action = actions.find(
          (a) =>
            a.can &&
            a.kind === kind &&
            (selectedChoice === undefined ||
              ("choice" in a && a.choice === selectedChoice))
        );
        expect(
          action,
          JSON.stringify({ kind, actions: actions.map((a) => a.kind) })
        ).toBeDefined();
        state = applyLegalAction({
          state,
          action: action!,
          ...lookups,
          ...extra,
        }).state;
      };
      expect(
        state.players.find((p) => p.id === ALICE)!.lifeNormalCoreCount
      ).toBe(4);
      apply("declare_private_triggered_effect");
      apply("resolve_pending_triggered_effect");
      apply("resolve_pending_effect_target", {
        targetInstanceIds: [opponentSpirit.instanceId],
      });
      apply("resolve_pending_step_optional_choice", {}, choice);
      if (choice === "execute") {
        expect(state.pendingCoreDistribution).not.toBeNull();
        apply("resolve_pending_core_distribution", {
          coreDistributionAllocations: { [handCard.instanceId]: 1 },
          coreDistributionSourceAllocations: { trash: 1 },
        });
        expect(
          state.cardInstances.find((c) => c.instanceId === handCard.instanceId)
        ).toMatchObject({
          definitionId: "BSTH02.7-TX01(B)",
          zone: "field",
          normalCoreCount: 1,
        });
      }
      drainResponses();
      expect(state.step).toBe(choice === "execute" ? "end" : "attack");
      expect(state.activePlayerId).toBe(BOB);
      expect(state.activeAttack).toBeNull();
      expect(state.pendingImmediateBattleEnds).toHaveLength(0);
      expect(state.pendingBattleEndDeferrals).toHaveLength(0);
      expect(state.pendingAttackStepEndFinalizations).toHaveLength(0);
    }
  );

  it("バトル中の転醒後コア配置 pending を挟んでも、このバトル終了時 end_attack_step を保持する", () => {
    const {
      lookups,
      state: baseState,
      effect,
      handCard,
      opponentSpirit,
    } = setup();
    const getRegisteredBurstActions = () => [];
    const battleState = withOpenBattle(
      {
        ...baseState,
        players: baseState.players.map((player) =>
          player.id === ALICE
            ? {
                ...player,
                voidNormalCoreCount: 10,
                trashNormalCoreCount: 3,
              }
            : player
        ),
      },
      opponentSpirit.instanceId
    );
    const inUseState = moveDeclaredHandMagicToInUse(
      battleState,
      handCard.instanceId
    );
    const afterBody = executeEffect({
      chainId: "test:bsth02-7-tx01-magic-rebirth-from-hand:683",
      state: inUseState,
      effect,
      sourceInstanceId: handCard.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions,
      activationZone: "hand",
    });
    const pending = afterBody.pendingStepOptionalChoice!;
    const afterExecute = applyLegalAction({
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
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;

    expect(
      afterExecute.pendingCoreDistribution?.continuation
        ?.battleEndDeferralAttackId
    ).toBe("attack:tx01-regression");

    const coreAction = getLegalActions({
      state: {
        ...afterExecute,
        activeAttack: null,
        battleResolutionGroup: null,
        window: "none",
        pendingImmediateBattleEnds: [],
        battleEntities: afterExecute.battleEntities.map((entity) => ({
          ...entity,
          attackState: "idle" as const,
        })),
      },
      actingPlayerId: ALICE,
      getCardDefinitionById: lookups.getCardDefinitionById,
    }).find((action) => action.kind === "resolve_pending_core_distribution")!;
    const resolved = applyLegalAction({
      state: {
        ...afterExecute,
        activeAttack: null,
        battleResolutionGroup: null,
        window: "none",
        pendingImmediateBattleEnds: [],
        battleEntities: afterExecute.battleEntities.map((entity) => ({
          ...entity,
          attackState: "idle" as const,
        })),
      },
      action: coreAction,
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      coreDistributionAllocations: { [handCard.instanceId]: 1 },
      coreDistributionSourceAllocations: { trash: 1 },
    }).state;

    expect(resolved.step).toBe("end");
    expect(resolved.pendingBattleEndDeferrals).toHaveLength(0);
    expect(resolved.pendingAttackStepEndFinalizations).toHaveLength(0);
    expect(resolved.log).toContain("effect:end_attack_step:finalized:alice");
  });

  it("転醒後コア配置で最低Lvを満たさなければ、countは増えず使用済みカードはA面でトラッシュへ行く", () => {
    const { lookups, state: baseState, effect, handCard } = setup();
    const state: GameState = {
      ...baseState,
      players: baseState.players.map((player) =>
        player.id === ALICE
          ? {
              ...player,
              voidNormalCoreCount: 10,
              trashNormalCoreCount: 3,
            }
          : player
      ),
    };
    const inUseState = moveDeclaredHandMagicToInUse(state, handCard.instanceId);
    const afterBody = executeEffect({
      chainId: "test:bsth02-7-tx01-magic-rebirth-from-hand:776",
      state: inUseState,
      effect,
      sourceInstanceId: handCard.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      activationZone: "hand",
    });
    const pending = afterBody.pendingStepOptionalChoice!;
    const afterExecute = applyLegalAction({
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
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
    }).state;
    const coreAction = getLegalActions({
      state: afterExecute,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookups.getCardDefinitionById,
    }).find((action) => action.kind === "resolve_pending_core_distribution")!;

    const failed = applyLegalAction({
      state: afterExecute,
      action: coreAction,
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
      coreDistributionAllocations: {},
    }).state;

    const usedCard = failed.cardInstances.find(
      (c) => c.instanceId === handCard.instanceId
    )!;
    expect(usedCard.zone).toBe("trash");
    expect(usedCard.definitionId).toBe("BSTH02.7-TX01(A)");
    const alice = failed.players.find((p) => p.id === ALICE)!;
    expect(alice.countValue).toBe(0);
    expect(alice.voidNormalCoreCount).toBe(10);
    expect(alice.reserveNormalCoreCount).toBe(1);
    expect(alice.trashNormalCoreCount).toBe(6);
    expect(alice.handCount).toBe(3);
    expect(
      failed.log.some((entry) =>
        entry.includes("reason=rebirth_minimum_core:placed=0<1")
      )
    ).toBe(true);
    expect(
      failed.log.some((entry) =>
        entry.includes(`effect:rebirth:${handCard.instanceId}:completion:count`)
      )
    ).toBe(false);
  });

  it("転醒許可窓を decline → 使用済みの A 面カードはトラッシュへ置かれ、コストは支払われない", () => {
    const { lookups, state, effect, handCard } = setup();
    const inUseState = moveDeclaredHandMagicToInUse(state, handCard.instanceId);
    const afterBody = executeEffect({
      chainId: "test:bsth02-7-tx01-magic-rebirth-from-hand:845",
      state: inUseState,
      effect,
      sourceInstanceId: handCard.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      activationZone: "hand",
    });
    const pending = afterBody.pendingStepOptionalChoice!;

    const declined = applyLegalAction({
      state: afterBody,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
    }).state;

    const usedCard = declined.cardInstances.find(
      (c) => c.instanceId === handCard.instanceId
    )!;
    expect(usedCard.zone).toBe("trash");
    expect(usedCard.definitionId).toBe("BSTH02.7-TX01(A)");
    const alice = declined.players.find((p) => p.id === ALICE)!;
    expect(alice.countValue).toBe(0);
    expect(alice.reserveNormalCoreCount).toBe(4);
    expect(alice.handCount).toBe(3);
  });

  it("executeMagicRebirthFromHand プリミティブ: 手元(set_aside)ゾーンのカードにも同様に発揮できる (handCount は変動しない)。カード本文の applicability は手札限定のため、この検証はプリミティブを直接呼ぶ (executeRebirth 経由の汎用委譲・将来の他カード再利用を検証する)。", () => {
    const lookups = buildLookups();
    const TX01 = lookups.getCardDefinitionById("BSTH02.7-TX01(A)")!;
    const setAsideCard = createCardInstance(TX01, {
      instanceId: "tx01-set-aside-1",
      ownerPlayerId: ALICE,
      zone: "set_aside",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [setAsideCard],
      playerOverrides: [{ voidNormalCoreCount: 10 }, {}],
    });

    let resolved = executeRebirth(
      state,
      ALICE,
      { kind: "rebirth", maxCount: 9, triggerDescription: "test" },
      setAsideCard.instanceId,
      lookups.getCardDefinitionById,
      "test:bsth02-7-tx01-magic-rebirth-from-hand:900"
    );
    expect(resolved.pendingCoreDistribution).not.toBeNull();
    const pending = resolved.pendingCoreDistribution!;
    const amount = pending.minTotal ?? 1;
    const coreAction = getLegalActions({
      state: resolved,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookups.getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;
    resolved = applyLegalAction({
      state: resolved,
      action: coreAction,
      ...lookups,
      coreDistributionAllocations: {
        [pending.candidates[0]!.instanceId]: amount,
      },
      coreDistributionSourceAllocations: { reserve: amount },
    }).state;

    const flipped = resolved.cardInstances.find(
      (c) => c.instanceId === setAsideCard.instanceId
    )!;
    expect(flipped.zone).toBe("field");
    expect(flipped.definitionId).toBe("BSTH02.7-TX01(B)");
    expect(flipped.normalCoreCount).toBe(1);
    const alice = resolved.players.find((p) => p.id === ALICE)!;
    expect(alice.countValue).toBe(1);
    expect(alice.voidNormalCoreCount).toBe(9);
    // set_aside は handCount に含めないため、離脱しても変動しない。
    expect(alice.handCount).toBe(4);
  });

  it("executeMagicRebirthFromHand プリミティブ: countBonusMode reset_to_zero は protectedCounts も落とす", () => {
    const lookups = buildLookups();
    const TX01 = lookups.getCardDefinitionById("BSTH02.7-TX01(A)")!;
    const handCard = createCardInstance(TX01, {
      instanceId: "tx01-hand-reset-count",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [handCard],
      playerOverrides: [
        {
          countValue: 5,
          voidNormalCoreCount: 10,
          protectedCounts: { 神喰: 3, 星霊: 1 },
        },
        {},
      ],
    });

    let resolved = executeRebirth(
      state,
      ALICE,
      {
        kind: "rebirth",
        maxCount: 9,
        triggerDescription: "test",
        countBonusMode: "reset_to_zero",
      },
      handCard.instanceId,
      lookups.getCardDefinitionById,
      "test:bsth02-7-tx01-magic-rebirth-from-hand:942"
    );
    expect(resolved.pendingCoreDistribution).not.toBeNull();
    const pending = resolved.pendingCoreDistribution!;
    const amount = pending.minTotal ?? 1;
    const coreAction = getLegalActions({
      state: resolved,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookups.getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;
    resolved = applyLegalAction({
      state: resolved,
      action: coreAction,
      ...lookups,
      coreDistributionAllocations: {
        [pending.candidates[0]!.instanceId]: amount,
      },
      coreDistributionSourceAllocations: { reserve: amount },
    }).state;

    const flipped = resolved.cardInstances.find(
      (c) => c.instanceId === handCard.instanceId
    )!;
    expect(flipped.zone).toBe("field");
    expect(flipped.definitionId).toBe("BSTH02.7-TX01(B)");

    const alice = resolved.players.find((p) => p.id === ALICE)!;
    expect(alice.countValue).toBe(0);
    expect(alice.voidNormalCoreCount).toBe(15);
    expect(alice.protectedCounts).toBeUndefined();
    expect(alice.handCount).toBe(3);
  });

  it("executeMagicRebirthFromHand プリミティブ: global Lvコスト上昇はB面スピリット投影で判定する", () => {
    const lookups = buildLookups();
    const TX01 = lookups.getCardDefinitionById("BSTH02.7-TX01(A)")!;
    const handCard = createCardInstance(TX01, {
      instanceId: "tx01-hand-lv-cost",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [handCard],
      }),
      activePlayerId: BOB,
      step: "main",
      activeContinuousEffects: [
        {
          effectId: "ce-tx01-lv-cost",
          sourceInstanceId: "bssl01-x03",
          sourceDefinitionId: "BSSL01-X03",
          actingPlayerId: BOB,
          timingScope: { player: "self", period: "turn" },
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "override_properties",
          targetFilter: {
            player: "opponent",
            category: ["spirit", "ultimate"],
          },
          metadata: { properties: { levelCostDelta: 2 } },
        },
      ],
    };

    let resolved = executeRebirth(
      state,
      ALICE,
      { kind: "rebirth", maxCount: 9, triggerDescription: "test" },
      handCard.instanceId,
      lookups.getCardDefinitionById,
      "test:bsth02-7-tx01-magic-rebirth-from-hand:1003"
    );
    expect(resolved.pendingCoreDistribution).not.toBeNull();
    const pending = resolved.pendingCoreDistribution!;
    const amount = pending.minTotal ?? 1;
    const coreAction = getLegalActions({
      state: resolved,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookups.getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;
    resolved = applyLegalAction({
      state: resolved,
      action: coreAction,
      ...lookups,
      coreDistributionAllocations: {
        [pending.candidates[0]!.instanceId]: amount,
      },
      coreDistributionSourceAllocations: { reserve: amount },
    }).state;

    const flipped = resolved.cardInstances.find(
      (c) => c.instanceId === handCard.instanceId
    )!;
    expect(flipped.zone).toBe("field");
    expect(flipped.definitionId).toBe("BSTH02.7-TX01(B)");
    expect(flipped.minimumRequiredCores).toBe(1);
    expect(flipped.normalCoreCount).toBe(3);
    expect(
      resolved.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(1);

    const afterSba = runStateBasedActions(
      resolved,
      lookups.getCardDefinitionById
    );
    const afterSbaCard = afterSba.state.cardInstances.find(
      (c) => c.instanceId === handCard.instanceId
    )!;
    expect(afterSba.checks).not.toContainEqual(
      expect.objectContaining({
        kind: "vanish_due_to_core_deficit",
        instanceId: handCard.instanceId,
      })
    );
    expect(afterSbaCard.pendingLeaveKind).toBeNull();
  });
});
