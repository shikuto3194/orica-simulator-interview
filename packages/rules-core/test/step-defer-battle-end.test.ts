import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeBattleResolution,
  executeEffect,
  applyLegalAction,
  flushPendingLeaves,
} from "../src/index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import type {
  CardDefinition,
  GameState,
  ActiveAttack,
  Effect,
} from "../src/index";

/**
 * step 単位 `deferTo: "battle_end"`（M13「大妖精」パターン）。
 *   「召喚する。その後、このバトル終了時、アタックステップを終了する。」
 *
 * 1 effect 内で即実行 step (draw) と遅延 step (end_attack_step) が混在する。
 * ルール正源: 10_rules/02_turn-flow-and-timing.md「バトル終了時 に誘発する効果を先に解決し」。
 */
describe("step 単位 deferTo:battle_end — 即実行 step と遅延 step の混在", () => {
  // effects[0]: step0 = draw(即実行), step1 = end_attack_step(deferTo:battle_end)
  const stepDeferEffect: Effect = {
    timing: { kind: "card_event", event: "summon" },
    steps: [
      { action: { kind: "draw", count: 1 } },
      {
        action: { kind: "end_attack_step" },
        connector: "sequential",
        deferTo: "battle_end",
      },
    ],
  };
  const sourceDef = {
    cardNo: "STEP-DEFER-001",
    name: "STEP-DEFER-001",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red", "red"],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 2000 },
      { level: 2, requiredCores: 3, bp: 4000 },
    ],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [stepDeferEffect],
  } as CardDefinition;

  const getCardDefinitionById = (id: string) =>
    id === sourceDef.cardNo ? sourceDef : undefined;
  const triggeredLookup = buildTriggeredEffectLookup([sourceDef]);

  function buildMidBattleState(): GameState {
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
      blockAssignments: [
        { participantEntityId: "be-1", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["be-1"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    // alice デッキに 1 枚（draw 用）。
    const deckCard = createCardInstance(sourceDef, {
      instanceId: "deck-1",
      ownerPlayerId: "alice",
      zone: "deck",
    });
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [src, deckCard],
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

  function buildPendingImmediateBattleEndState(): GameState {
    const base = buildMidBattleState();
    const attackId = base.activeAttack!.attackId;
    return {
      ...base,
      activeAttack: null,
      battleResolutionGroup: null,
      window: "none",
      battleEntities: base.battleEntities.map((entity) => ({
        ...entity,
        attackState: "idle" as const,
      })),
      pendingImmediateBattleEnds: [
        {
          attackId,
          participantInstanceIds: ["src-1"],
          blockSideInstanceIds: [],
          participantSnapshots: [
            {
              entityId: "be-1",
              memberInstanceIds: ["src-1"],
              resolvedBp: 4000,
              resolvedSymbols: ["red"],
              blockedBy: [],
            },
          ],
          appliedLifeDamage: 1,
          participantOwnSymbols: [{ entityId: "be-1", ownSymbols: 1 }],
        },
      ],
    };
  }

  const aliceHandCount = (s: GameState) =>
    s.cardInstances.filter(
      (c) => c.ownerPlayerId === "alice" && c.zone === "hand"
    ).length;

  function declineBurstChecks(state: GameState): GameState {
    let current = state;
    while (current.pendingBurstChecks.length > 0) {
      const pending = current.pendingBurstChecks[0]!;
      current = applyLegalAction({
        state: current,
        action: {
          chainId: "test:step-defer-battle-end:153",
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

  it("即実行 step は走り、deferTo step は予約され step は終了しない", () => {
    const state = buildMidBattleState();
    const aliceHandBefore = aliceHandCount(state);

    const after = executeEffect({
      chainId: "test:step-defer-battle-end:174",
      state,
      effect: stepDeferEffect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      effectIndex: 0,
    });

    // draw (即実行 step0) は走った
    const aliceHandAfter = aliceHandCount(after);
    expect(aliceHandAfter).toBe(aliceHandBefore + 1);
    // end_attack_step (step1) は走らず予約された
    expect(after.step).toBe("attack");
    expect(after.pendingBattleEndDeferrals).toHaveLength(1);
    expect(after.pendingBattleEndDeferrals[0]).toEqual(
      expect.objectContaining({
        attackId: "attack:be-1:1",
        sourceInstanceId: "src-1",
        effectIndex: 0,
        resumeFromStepIndex: 1,
      })
    );
  });

  it("合体ブレイヴ提供の step-level battle_end は予約時の effect source field requirement を保持する", () => {
    const hostDef = {
      ...sourceDef,
      cardNo: "STEP-DEFER-COMBINED-HOST",
      effects: [],
    } as CardDefinition;
    const braveDef = {
      ...sourceDef,
      cardNo: "STEP-DEFER-COMBINED-BRAVE",
      printedCategory: "brave",
      effects: [stepDeferEffect],
    } as CardDefinition;
    const getCombinedDef = (id: string) =>
      id === hostDef.cardNo
        ? hostDef
        : id === braveDef.cardNo
          ? braveDef
          : undefined;
    const host = createCardInstance(hostDef, {
      instanceId: "combined-host-step-deferral",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 3,
      attachedChildrenIds: ["combined-brave-step-deferral"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "combined-brave-step-deferral",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
      attachedToInstanceId: host.instanceId,
    });
    const deckCard = createCardInstance(sourceDef, {
      instanceId: "combined-step-deck-1",
      ownerPlayerId: "alice",
      zone: "deck",
    });
    const state: GameState = {
      ...buildMidBattleState(),
      cardInstances: [host, brave, deckCard],
      battleEntities: [
        {
          entityId: "be-1",
          resolvedBp: 4000,
          attackState: "attacking",
          resolvedSymbols: ["red"],
          memberInstanceIds: [host.instanceId],
        },
      ],
    };

    const after = executeEffect({
      chainId: "test:step-defer-battle-end:251",
      state,
      effect: stepDeferEffect,
      sourceInstanceId: host.instanceId,
      effectSourceInstanceId: brave.instanceId,
      effectSourceDefinitionId: braveDef.cardNo,
      actingPlayerId: "alice",
      getCardDefinitionById: getCombinedDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        braveDef,
      ]),
      effectIndex: 0,
    });

    expect(after.pendingBattleEndDeferrals[0]).toMatchObject({
      sourceInstanceId: host.instanceId,
      effectSourceInstanceId: brave.instanceId,
      effectSourceDefinitionId: braveDef.cardNo,
      sourceCardReferenceInstanceId: brave.instanceId,
      effectSourceOnFieldRequired: true,
      effectSourceAttachmentRequired: true,
    });
  });

  it("バトル終了時に deferTo step (end_attack_step) のみ再開して走る", () => {
    const queued = executeEffect({
      chainId: "test:step-defer-battle-end:276",
      state: buildMidBattleState(),
      effect: stepDeferEffect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      effectIndex: 0,
    });
    const handAfterQueue = aliceHandCount(queued);

    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });

    // 再開で end_attack_step 予約が立ち、burst check 解決後の実際の終了時に step=end。
    expect(resolved.state.step).toBe("attack");
    expect(resolved.state.pendingAttackStepEndFinalizations).toHaveLength(1);
    const afterBurst = declineBurstChecks(resolved.state);
    expect(afterBurst.step).toBe("end");
    expect(resolved.state.pendingBattleEndDeferrals).toHaveLength(0);
    // 再開は step1 からなので draw (step0) は二重実行されない
    expect(aliceHandCount(afterBurst)).toBe(handAfterQueue);
  });

  it("バトル外 (activeAttack なし) では deferTo step 以降が不発", () => {
    const base = buildMidBattleState();
    const noBattle: GameState = {
      ...base,
      step: "main",
      window: "none",
      activeAttack: null,
      battleEntities: [],
    };
    const after = executeEffect({
      chainId: "test:step-defer-battle-end:313",
      state: noBattle,
      effect: stepDeferEffect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      effectIndex: 0,
    });
    expect(after.pendingBattleEndDeferrals).toHaveLength(0);
    expect(after.step).toBe("main");
  });

  it("activeAttack が消えた battle_end 再開待ち中でも pendingImmediateBattleEnds の attackId へ予約する", () => {
    const state = buildPendingImmediateBattleEndState();
    const handBefore = aliceHandCount(state);

    const after = executeEffect({
      chainId: "test:step-defer-battle-end:330",
      state,
      effect: stepDeferEffect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      effectIndex: 0,
    });

    expect(aliceHandCount(after)).toBe(handBefore + 1);
    expect(after.pendingImmediateBattleEnds).toHaveLength(1);
    expect(after.pendingImmediateBattleEnds[0]?.attackId).toBe("attack:be-1:1");
    expect(after.pendingBattleEndDeferrals).toHaveLength(1);
    expect(after.pendingBattleEndDeferrals[0]).toMatchObject({
      attackId: "attack:be-1:1",
      sourceInstanceId: "src-1",
      effectIndex: 0,
      resumeFromStepIndex: 1,
    });
    expect(after.pendingAttackStepEndFinalizations).toHaveLength(0);
    expect(after.log).toContain(
      "effect:step-deferred-to-battle-end:src-1:0:1:attack:be-1:1"
    );
    expect(after.log).not.toContain(
      "effect:step-deferred-battle-end-no-battle:src-1:0:1"
    );
  });

  it("field 発揮の step-level battle_end は前段で source が場外へ移っても field 起点 requirement を保持する", () => {
    const sourceLeavesBeforeDeferEffect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        { action: { kind: "move_self", destination: "hand" } },
        {
          action: { kind: "count_increase", player: "self", amount: 7 },
          connector: "sequential",
          deferTo: "battle_end",
        },
      ],
    };
    const sourceLeavesBeforeDeferDef = {
      ...sourceDef,
      cardNo: "STEP-DEFER-SOURCE-LEAVES-001",
      name: "STEP-DEFER-SOURCE-LEAVES-001",
      effects: [sourceLeavesBeforeDeferEffect],
    } as CardDefinition;
    const getSourceLeavesBeforeDeferDefById = (id: string) =>
      id === sourceLeavesBeforeDeferDef.cardNo
        ? sourceLeavesBeforeDeferDef
        : getCardDefinitionById(id);
    const baseState = buildMidBattleState();
    const state: GameState = {
      ...baseState,
      cardInstances: baseState.cardInstances.map((card) =>
        card.instanceId === "src-1"
          ? { ...card, definitionId: sourceLeavesBeforeDeferDef.cardNo }
          : card
      ),
    };

    const pending = executeEffect({
      chainId: "test:step-defer-battle-end:391",
      state,
      effect: sourceLeavesBeforeDeferEffect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getSourceLeavesBeforeDeferDefById,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        sourceLeavesBeforeDeferDef,
      ]),
      effectIndex: 0,
    });

    const queued = flushPendingLeaves(
      pending,
      getSourceLeavesBeforeDeferDefById
    );
    expect(
      queued.cardInstances.find((card) => card.instanceId === "src-1")?.zone
    ).toBe("hand");
    expect(queued.pendingBattleEndDeferrals).toHaveLength(1);
    expect(queued.pendingBattleEndDeferrals[0]?.sourceOnFieldRequired).not.toBe(
      false
    );

    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById: getSourceLeavesBeforeDeferDefById,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        sourceLeavesBeforeDeferDef,
      ]),
      getRegisteredBurstActions: undefined,
    });

    expect(
      resolved.state.players.find((player) => player.id === "alice")?.countValue
    ).toBe(0);
    expect(resolved.state.pendingBattleEndDeferrals).toHaveLength(0);
    expect(resolved.state.log).toContain(
      "battle:end-deferral:skip-source-left:attack:be-1:1:src-1:0"
    );
  });

  // BSTH02.7-TX01(A)「グランギニョル座の怪人」: conditional_cost (rebirth) 失敗時に
  // deferTo:battle_end step 以降を無条件で予約しないための state-based condition ゲート。
  describe("deferTo:battle_end + condition (self_state:on_field) ゲート", () => {
    const gatedEffect: Effect = {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        {
          connector: "sequential",
          condition: [{ kind: "self_state", state: "on_field" }],
          deferTo: "battle_end",
          action: { kind: "end_attack_step" },
        },
      ],
    };
    const gatedDef = {
      ...sourceDef,
      cardNo: "STEP-DEFER-GATED-001",
      name: "STEP-DEFER-GATED-001",
      effects: [gatedEffect],
    } as CardDefinition;
    const getGatedDefById = (id: string) =>
      id === gatedDef.cardNo ? gatedDef : undefined;

    // buildMidBattleState() の card instance は sourceDef (cardNo:"STEP-DEFER-001")。
    // defer resume は instance.definitionId から getCardDefinitionById で効果を
    // 再取得する (effect-interpreter.ts resolveImmediateBattleEndDeferral) ため、
    // instance の definitionId を gatedDef.cardNo に差し替える必要がある。
    function buildGatedMidBattleState(): GameState {
      const base = buildMidBattleState();
      return {
        ...base,
        cardInstances: base.cardInstances.map((c) =>
          c.instanceId === "src-1" ? { ...c, definitionId: gatedDef.cardNo } : c
        ),
      };
    }

    it("condition 不成立 (フィールド外) なら defer を予約しない", () => {
      const base = buildGatedMidBattleState();
      const offField: GameState = {
        ...base,
        cardInstances: base.cardInstances.map((c) =>
          c.instanceId === "src-1" ? { ...c, zone: "hand" as const } : c
        ),
      };
      const after = executeEffect({
        chainId: "test:step-defer-battle-end:474",
        state: offField,
        effect: gatedEffect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getGatedDefById,
        getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
          gatedDef,
        ]),
        effectIndex: 0,
      });
      expect(after.pendingBattleEndDeferrals).toHaveLength(0);
    });

    it("condition 成立 (フィールド上) なら defer を予約し、バトル終了時に resume して action が走る", () => {
      const state = buildGatedMidBattleState();
      const queued = executeEffect({
        chainId: "test:step-defer-battle-end:490",
        state,
        effect: gatedEffect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getGatedDefById,
        getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
          gatedDef,
        ]),
        effectIndex: 0,
      });
      expect(queued.pendingBattleEndDeferrals).toHaveLength(1);

      const resolved = executeBattleResolution({
        state: queued,
        getCardDefinitionById: getGatedDefById,
        getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
          gatedDef,
        ]),
        getRegisteredBurstActions: undefined,
      });
      expect(resolved.state.pendingAttackStepEndFinalizations).toHaveLength(1);
      expect(resolved.state.pendingBattleEndDeferrals).toHaveLength(0);
    });
  });

  describe("deferTo:battle_end + stepCondition(ref_succeeded) ゲート", () => {
    const stepConditionGatedEffect: Effect = {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        {
          id: "decrease_count",
          action: { kind: "count_decrease", player: "self", amount: 1 },
        },
        {
          connector: "sequential",
          deferTo: "battle_end",
          stepCondition: {
            kind: "ref_succeeded",
            stepId: "decrease_count",
          },
          action: { kind: "count_increase", player: "self", amount: 7 },
        },
      ],
    };
    const stepConditionGatedDef = {
      ...sourceDef,
      cardNo: "STEP-DEFER-STEP-CONDITION-001",
      name: "STEP-DEFER-STEP-CONDITION-001",
      effects: [stepConditionGatedEffect],
    } as CardDefinition;
    const getStepConditionGatedDefById = (id: string) =>
      id === stepConditionGatedDef.cardNo ? stepConditionGatedDef : undefined;
    const stepConditionTriggeredLookup = buildTriggeredEffectLookup([
      stepConditionGatedDef,
    ]);

    function buildStepConditionGatedState(countValue: number): GameState {
      const base = buildMidBattleState();
      return {
        ...base,
        players: base.players.map((player) =>
          player.id === "alice" ? { ...player, countValue } : player
        ),
        cardInstances: base.cardInstances.map((card) =>
          card.instanceId === "src-1"
            ? { ...card, definitionId: stepConditionGatedDef.cardNo }
            : card
        ),
      };
    }

    it("前段成功なら stepCondition を満たして予約し、battle_end 再開でも同じ文脈で実行する", () => {
      const queued = executeEffect({
        chainId: "test:step-defer-battle-end:563",
        state: buildStepConditionGatedState(1),
        effect: stepConditionGatedEffect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getStepConditionGatedDefById,
        getRegisteredTriggeredEffectActions: stepConditionTriggeredLookup,
        effectIndex: 0,
      });
      expect(
        queued.players.find((player) => player.id === "alice")?.countValue
      ).toBe(0);
      expect(queued.pendingBattleEndDeferrals).toHaveLength(1);
      expect(queued.pendingBattleEndDeferrals[0]).toMatchObject({
        resumeFromStepIndex: 1,
        restoredStepContext: {
          results: {
            decrease_count: {
              succeeded: true,
            },
          },
        },
      });

      const resolved = executeBattleResolution({
        state: queued,
        getCardDefinitionById: getStepConditionGatedDefById,
        getRegisteredTriggeredEffectActions: stepConditionTriggeredLookup,
        getRegisteredBurstActions: undefined,
      });
      expect(
        resolved.state.players.find((player) => player.id === "alice")
          ?.countValue
      ).toBe(7);
      expect(resolved.state.pendingBattleEndDeferrals).toHaveLength(0);
    });

    it("前段失敗なら deferTo step を予約しない", () => {
      const after = executeEffect({
        chainId: "test:step-defer-battle-end:601",
        state: buildStepConditionGatedState(0),
        effect: stepConditionGatedEffect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getStepConditionGatedDefById,
        getRegisteredTriggeredEffectActions: stepConditionTriggeredLookup,
        effectIndex: 0,
      });
      expect(
        after.players.find((player) => player.id === "alice")?.countValue
      ).toBe(0);
      expect(after.pendingBattleEndDeferrals).toHaveLength(0);
    });
  });
});
