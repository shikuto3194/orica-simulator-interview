import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeBattleResolution,
  executeEffect,
  applyLegalAction,
} from "../src";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { finalizePendingEndFinalizations } from "../src/effect/structured-state-grants";
import { resolveStackCascade } from "../src/legal/stack-resolution-core";
import type { ActiveAttack, CardDefinition, GameState } from "../src";

/**
 * 「このバトル終了時、アタックステップを終了する」(deferTo / deferredTo: "battle_end")
 * のカード変換検証。即時 end_attack_step で近似していた stub を解消したカード:
 *   - BSTH09-M01 [2,3]: バースト召喚 (即実行) → このバトル終了時アタックステップ終了 (step 単位 deferTo)
 *   - BSTH04-R01 [2,3]: バースト召喚 (即実行) → このバトル終了時アタックステップ終了 (step 単位 deferTo)
 *   - BSRK01-C05 [0,1]: フラッシュ効果全体をバトル終了時へ遅延 (effect 単位 deferredTo)
 *
 * ルール正源: 10_rules/05 L87「バトル終了時 はバトル1件ごとの終了、アタック終了時 は
 * アタックステップ全体の終了を指し、区別する」。
 * 盤面変化 assert: 効果発揮時点では step="attack" のまま、当該バトル解決完了後に step="end" へ。
 */

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const triggeredLookup = buildTriggeredEffectLookup([...ALL_CARDS]);

function buildMidBattleState(sourceDef: CardDefinition): GameState {
  const src = createCardInstance(sourceDef, {
    instanceId: "src-1",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 3,
  });
  const activeAttack: ActiveAttack = {
    attackId: "attack:be-1:1",
    primaryEntityId: "be-1",
    participantEntityIds: ["be-1"],
    groupMode: "single",
    target: { kind: "player", playerId: "bob" },
    blockAssignments: [{ participantEntityId: "be-1", blockedByEntityIds: [] }],
    symbolResolutionOrder: ["be-1"],
    flashBeforeBlockCompleted: true,
    flashAfterBlockCompleted: false,
    flashWindowState: null,
  };
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [src],
    }),
    turnNumber: 2,
    activePlayerId: "alice",
    step: "attack",
    window: "declare_attack",
    activeAttack,
    battleEntities: [
      {
        entityId: "be-1",
        resolvedBp: 4000,
        attackState: "attacking",
        resolvedSymbols: ["red"],
        memberInstanceIds: ["src-1"],
      },
    ],
  };
}

function buildMidBattleStateWithHandSource(
  sourceDef: CardDefinition
): GameState {
  const source = createCardInstance(sourceDef, {
    instanceId: "src-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "hand",
  });
  const attackerDef = cardNoMap.get("BSTH04-C01")!;
  const attacker = createCardInstance(attackerDef, {
    instanceId: "attacker-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    cores: 1,
  });
  const activeAttack: ActiveAttack = {
    attackId: "attack:be-1:1",
    primaryEntityId: "be-1",
    participantEntityIds: ["be-1"],
    groupMode: "single",
    target: { kind: "player", playerId: "bob" },
    blockAssignments: [{ participantEntityId: "be-1", blockedByEntityIds: [] }],
    symbolResolutionOrder: ["be-1"],
    flashBeforeBlockCompleted: true,
    flashAfterBlockCompleted: false,
    flashWindowState: null,
  };
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ handCount: 1, reserveNormalCoreCount: 5 }, {}],
      cardInstances: [source, attacker],
    }),
    turnNumber: 2,
    activePlayerId: "alice",
    step: "attack",
    window: "declare_attack",
    activeAttack,
    battleEntities: [
      {
        entityId: "be-1",
        resolvedBp: 4000,
        attackState: "attacking",
        resolvedSymbols: ["yellow"],
        memberInstanceIds: ["attacker-1"],
      },
    ],
  };
}

function declineBurstChecks(state: GameState): GameState {
  let current = state;
  while (current.pendingBurstChecks.length > 0) {
    const pending = current.pendingBurstChecks[0]!;
    current = applyLegalAction({
      state: current,
      action: {
        chainId: "test:battle-end-attack-step-end-cards:132",
        kind: "decline_pending_burst_check",
        actionId: `decline:${pending.checkId}`,
        can: true,
        reason: "test",
        actingPlayerId: pending.actingPlayerId,
        checkId: pending.checkId,
        eventKind: pending.eventKind,
        relatedPlayerId: pending.relatedPlayerId,
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
  }
  return current;
}

describe("BSTH09-M01 [2,3] バースト召喚 + このバトル終了時アタックステップ終了 (step deferTo)", () => {
  const card = cardNoMap.get("BSTH09-M01")!;
  // burst effect (textRef [2,3]) = 召喚 + deferTo:battle_end end_attack_step
  const burstEffect = card.effects!.find((e) => e.timing.kind === "burst")!;

  it("end_attack_step step に deferTo:battle_end が付く (即時近似でない)", () => {
    expect(burstEffect.steps[0]!.action).toEqual({
      kind: "summon",
      target: { kind: "self" },
      costModifier: "free",
    });
    const endStep = burstEffect.steps.find(
      (s) => s.action.kind === "end_attack_step"
    );
    expect(endStep).toBeDefined();
    expect(endStep!.deferTo).toBe("battle_end");
  });

  it("効果発揮時は step=attack のまま予約され、バトル終了後に step=end へ", () => {
    const state = buildMidBattleStateWithHandSource(card);
    const queued = executeEffectWithChosenMinimumCores({
      chainId: "test:battle-end-attack-step-end-cards:168",
      state,
      effect: burstEffect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      effectIndex: card.effects!.indexOf(burstEffect),
    });
    // 発揮時点ではアタックステップ継続、battle_end 予約 1 件。
    expect(queued.step).toBe("attack");
    expect(queued.pendingBattleEndDeferrals).toHaveLength(1);
    expect(queued.pendingBattleEndDeferrals[0]).toEqual(
      expect.objectContaining({
        attackId: "attack:be-1:1",
        sourceInstanceId: "src-1",
      })
    );

    // バトル解決完了で予約 step (end_attack_step) が再開し step=end。
    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });
    expect(resolved.state.step).toBe("attack");
    expect(resolved.state.pendingAttackStepEndFinalizations).toHaveLength(1);
    expect(declineBurstChecks(resolved.state).step).toBe("end");
    expect(resolved.state.pendingBattleEndDeferrals).toHaveLength(0);
  });
});

describe("BSTH04-R01 [2,3] バースト召喚 + このバトル終了時アタックステップ終了 (step deferTo)", () => {
  const card = cardNoMap.get("BSTH04-R01")!;
  const burstEffect = card.effects!.find((e) => e.timing.kind === "burst")!;
  const fieldImmunityEffect = card.effects!.find(
    (e) => e.textRef?.[0] === 5 && e.textRef?.[1] === 6
  )!;

  it("end_attack_step step に deferTo:battle_end が付く (即時近似でない)", () => {
    expect(burstEffect.steps[0]!.action).toEqual({
      kind: "summon",
      target: { kind: "self" },
      costModifier: "free",
    });
    const endStep = burstEffect.steps.find(
      (s) => s.action.kind === "end_attack_step"
    );
    expect(endStep).toBeDefined();
    expect(endStep!.deferTo).toBe("battle_end");
    expect(burstEffect.stub).toBeUndefined();
  });

  it("効果発揮時は step=attack のまま予約され、バトル終了後に step=end へ", () => {
    const state = buildMidBattleStateWithHandSource(card);
    const queued = executeEffectWithChosenMinimumCores({
      chainId: "test:battle-end-attack-step-end-cards:224",
      state,
      effect: burstEffect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      effectIndex: card.effects!.indexOf(burstEffect),
    });
    expect(queued.step).toBe("attack");
    expect(queued.pendingMultiPlacement).toBeNull();
    expect(queued.pendingBattleEndDeferrals).toHaveLength(1);
    expect(queued.pendingBattleEndDeferrals[0]).toEqual(
      expect.objectContaining({
        attackId: "attack:be-1:1",
        sourceInstanceId: "src-1",
      })
    );
    const summoned = queued.cardInstances.find(
      (c) => c.instanceId === "src-1"
    )!;
    expect(summoned.zone).toBe("field");
    expect(summoned.normalCoreCount).toBeGreaterThanOrEqual(
      card.levelDefs[0]!.requiredCores
    );

    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });
    expect(resolved.state.step).toBe("attack");
    expect(resolved.state.pendingAttackStepEndFinalizations).toHaveLength(1);
    expect(declineBurstChecks(resolved.state).step).toBe("end");
    expect(resolved.state.pendingBattleEndDeferrals).toHaveLength(0);
  });

  it("Lv耐性は self に、相手スピリット/ネクサス発生源だけを対象にする", () => {
    const action = fieldImmunityEffect.steps[0]!.action;
    expect(action).toEqual({
      kind: "effect_immunity",
      target: { kind: "self" },
      duration: { scope: "while_on_field" },
      sourceScope: { categories: ["spirit", "nexus"] },
    });
  });
});

describe("BSRK01-C05 [0,1] フラッシュ: このバトル終了時アタックステップ終了 (effect deferredTo)", () => {
  const card = cardNoMap.get("BSRK01-C05")!;
  const flashEffect = card.effects![0]!;

  it("timing.deferredTo=battle_end の flash effect で end_attack_step を遅延", () => {
    expect(flashEffect.timing).toEqual({
      kind: "activated",
      mode: "flash",
      deferredTo: "battle_end",
    });
    expect(flashEffect.steps[0]!.action.kind).toBe("end_attack_step");
  });

  it("効果発揮時は step=attack のまま予約され、バトル終了後に step=end へ", () => {
    const state = buildMidBattleState(card);
    const queued = executeEffect({
      chainId: "test:battle-end-attack-step-end-cards:288",
      state,
      effect: flashEffect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      effectIndex: 0,
    });
    expect(queued.step).toBe("attack");
    expect(queued.pendingBattleEndDeferrals).toHaveLength(1);

    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });
    expect(resolved.state.step).toBe("attack");
    expect(resolved.state.pendingAttackStepEndFinalizations).toHaveLength(1);
    expect(declineBurstChecks(resolved.state).step).toBe("end");
    expect(resolved.state.pendingBattleEndDeferrals).toHaveLength(0);
  });
});

describe("EDH-0002-00: 対象選択後に完了するバーストと battle-end entry", () => {
  it("安定した stack cascade が deferred battle-end entry を drain し、予約済み end_attack_step を確定できる", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      turnNumber: 10,
      activePlayerId: "bob",
      step: "attack",
      window: "none",
      pendingImmediateBattleEnds: [
        {
          attackId: "attack:edh-targeted-burst",
          participantInstanceIds: [],
          blockSideInstanceIds: [],
          participantSnapshots: [],
          appliedLifeDamage: 1,
        },
      ],
      pendingAttackStepEndFinalizations: [
        {
          pendingId: "attack-step-end:10:0",
          actingPlayerId: "bob",
          sourceInstanceId: "bob",
          createdAtTurn: 10,
        },
      ],
    };

    // `resolve_pending_effect_target` がバースト本体を再開し終えた後は、残り stack
    // が無くてもこの cascade 出口を通る。ここで battle-end entry を再 drain しないと、
    // pendingAttackStepEndFinalizations が永続 blocker になる。
    const afterCascade = resolveStackCascade(state, [], {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });

    expect(afterCascade.pendingImmediateBattleEnds).toHaveLength(0);
    const finalized = finalizePendingEndFinalizations(
      afterCascade,
      getCardDefinitionById
    );
    expect(finalized.pendingAttackStepEndFinalizations).toHaveLength(0);
    expect(finalized.step).toBe("end");
  });
});
