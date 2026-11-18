/**
 * 指定アタック (10_rules/05b §指定アタック):
 * 「アタック宣言 -> ブロック宣言」間の通常フラッシュ/バーストが片付いたあと、まだ指定アタックが
 * 成立している場合に限り強制ブロック宣言へ飛ぶ。対象がバースト解決中に消えたら通常のブロック前
 * フラッシュ (プレイヤー対象) へフォールバックする (05b:44, 51-54)。
 *
 * `maybeFinalizeDesignatedAttackAfterPendingReactions` (attack-burst-flow.ts) がこの確定ロジックの
 * 実体だが、designated-attack-primitive cluster の他テスト (designated-attack-target-legality.test.ts)
 * は宣言時ガードのみを検証しており、この「宣言後バースト解決を経ての確定/フォールバック」自体には
 * 専用テストが無かったギャップを埋める (cluster 実装メモ「実装済み4箇所」のうち唯一未検証だった箇所)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  confirmAttackDeclarationAsAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  useAttackAsAction,
  usePassPreDeclarationStackAsAction,
} from "../src";
import { buildBurstEffectLookup } from "../src/effect/structured-effect-registrations";
import { maybeFinalizeDesignatedAttackAfterPendingReactions } from "../src/legal/attack-burst-flow";
import type { ActiveStack, CardDefinition, GameState } from "../src";

function makeSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `test ${cardNo}`,
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    tribe: "test",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

const ATTACKER = makeSpirit("TEST-DAB-ATTACKER");
const TARGET = makeSpirit("TEST-DAB-TARGET");
const BSTH03_TENSEI_R01_A = ALL_CARDS.find(
  (card) => card.cardNo === "BSTH03-転醒R01(A)"
)!;
const BSTH03_M04 = ALL_CARDS.find((card) => card.cardNo === "BSTH03-M04")!;
const BSFT01_TR11_A = ALL_CARDS.find(
  (card) => card.cardNo === "BSFT01-TR11(A)"
)!;
const cardMap = new Map<string, CardDefinition>([
  [ATTACKER.cardNo, ATTACKER],
  [TARGET.cardNo, TARGET],
]);
const getCardDefinitionById = (id: string) => cardMap.get(id);

function buildDesignatedAttackDeclaredState(
  attackingPlayerId = "alice"
): GameState {
  const defendingPlayerId = attackingPlayerId === "alice" ? "bob" : "alice";
  const state: GameState = {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    activePlayerId: attackingPlayerId,
    step: "attack",
    cardInstances: [
      createCardInstance(ATTACKER, {
        instanceId: "attacker-1",
        ownerPlayerId: attackingPlayerId,
        controllerPlayerId: attackingPlayerId,
        zone: "field",
        cores: 1,
      }),
      createCardInstance(TARGET, {
        instanceId: "target-1",
        ownerPlayerId: defendingPlayerId,
        controllerPlayerId: defendingPlayerId,
        zone: "field",
        cores: 1,
      }),
    ],
  };
  const rebuilt = rebuildContinuousEffectsFromField(
    state,
    getCardDefinitionById
  );

  const tentative = useAttackAsAction({
    state: rebuilt,
    actingPlayerId: attackingPlayerId,
    sourceInstanceId: "attacker-1",
    targetInstanceId: "target-1",
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: undefined,
  });
  const afterPass = usePassPreDeclarationStackAsAction({
    state: tentative,
    actingPlayerId: defendingPlayerId,
  });
  const result = confirmAttackDeclarationAsAction(
    afterPass.closedWindow!,
    afterPass.state,
    { getCardDefinitionById }
  );
  return result.state;
}

describe("指定アタック: 宣言後バースト解決を経ての確定/フォールバック", () => {
  it.each(["alice", "bob"])(
    "%s の指定対象の旧IDが消えても相手プレイヤーへの通常アタックへ戻り、新個体を強制ブロックさせない",
    (attackingPlayerId) => {
      const declared = buildDesignatedAttackDeclaredState(attackingPlayerId);
      const oldTarget = declared.cardInstances.find(
        (card) => card.instanceId === "target-1"
      )!;
      // Reverse rebirth creates a new instance; it is not the designated target.
      const oldIdGone: GameState = {
        ...declared,
        cardInstances: [
          ...declared.cardInstances.filter(
            (card) => card.instanceId !== oldTarget.instanceId
          ),
          { ...oldTarget, instanceId: "target-1:reverse-rebirth" },
        ],
      };
      const finalized = maybeFinalizeDesignatedAttackAfterPendingReactions(
        oldIdGone,
        { getCardDefinitionById }
      );
      expect(finalized.activeAttack?.target).toEqual({
        kind: "player",
        playerId: oldTarget.controllerPlayerId,
      });
      expect(
        finalized.activeAttack?.designatedTargetInstanceId
      ).toBeUndefined();
      expect(finalized.activeAttack?.flashBeforeBlockCompleted).toBe(false);
      expect(finalized.preDeclarationStackWindow).toBeNull();
      expect(finalized.window).toBe("declare_attack");
      expect(finalized.activeAttack?.blockAssignments).toEqual([
        {
          participantEntityId: "battle-entity:attacker-1",
          blockedByEntityIds: [],
        },
      ]);
      expect(finalized.cardInstances).toEqual(oldIdGone.cardInstances);
    }
  );

  it("対象が依然として合法なら、待機列が空になった時点で強制ブロック(forced_block)窓へ確定する", () => {
    const declared = buildDesignatedAttackDeclaredState();
    expect(declared.activeAttack?.designatedTargetInstanceId).toBe("target-1");
    expect(declared.window).toBe("declare_attack");

    const finalized = maybeFinalizeDesignatedAttackAfterPendingReactions(
      declared,
      { getCardDefinitionById }
    );

    expect(finalized.window).toBe("pre_declaration_stack");
    expect(finalized.preDeclarationStackWindow).toMatchObject({
      kind: "forced_block",
      sourceInstanceId: "target-1",
      actingPlayerId: "bob",
      priorityPlayerId: "alice",
    });
    // 指定アタックの対象/activeAttack 自体は維持される (強制ブロック成立前提)。
    expect(finalized.activeAttack?.designatedTargetInstanceId).toBe("target-1");
  });

  it("対象がバースト解決中にフィールドを離れたら、指定アタックは無効化されプレイヤー対象へフォールバックする", () => {
    const declared = buildDesignatedAttackDeclaredState();
    // バースト解決の結果、指定対象が破壊されてフィールドを離れた状況を模す。
    const targetLeftField: GameState = {
      ...declared,
      cardInstances: declared.cardInstances.map((c) =>
        c.instanceId === "target-1" ? { ...c, zone: "trash" as const } : c
      ),
    };

    const finalized = maybeFinalizeDesignatedAttackAfterPendingReactions(
      targetLeftField,
      { getCardDefinitionById }
    );

    expect(finalized.window).toBe("declare_attack");
    expect(finalized.activeAttack?.target).toEqual({
      kind: "player",
      playerId: "bob",
    });
    expect(finalized.activeAttack?.designatedTargetInstanceId).toBeUndefined();
    // フォールバック後は通常のブロック前フラッシュへ戻れるよう、ブロック割当がリセットされている。
    expect(
      finalized.activeAttack?.blockAssignments.every(
        (assignment) => assignment.blockedByEntityIds.length === 0
      )
    ).toBe(true);
  });

  it("待機中の pendingTriggeredEffects/pendingBurstChecks が残っている間は確定しない (バースト優先処理待ち)", () => {
    const declared = buildDesignatedAttackDeclaredState();
    const withPendingBurst: GameState = {
      ...declared,
      pendingBurstChecks: [
        {
          checkId: "burst-check:probe",
          actingPlayerId: "bob",
          eventKind: "attack_after",
          source: "action_resolution",
          chainId: "test:designated-attack-burst-finalization:167",
          attackId: declared.activeAttack!.attackId,
          relatedPlayerId: "bob",
          relatedInstanceId: null,
          amount: 1,
          step: declared.step,
          window: declared.window,
          resolvedBurstCardInstanceIds: [],
        },
      ],
    };

    const finalized = maybeFinalizeDesignatedAttackAfterPendingReactions(
      withPendingBurst,
      { getCardDefinitionById }
    );

    // 待機列が空でない間は無変化 (== 同一参照) であることを確認する。
    expect(finalized).toBe(withPendingBurst);
    expect(finalized.window).toBe("declare_attack");
  });

  it("EDH-0007: 空の stack cascade が残っていても forced_block のパスでブロック宣言を確定する", () => {
    const declared = buildDesignatedAttackDeclaredState();
    const forcedBlockWindow =
      maybeFinalizeDesignatedAttackAfterPendingReactions(declared, {
        getCardDefinitionById,
      });
    expect(forcedBlockWindow.preDeclarationStackWindow).toMatchObject({
      kind: "forced_block",
      priorityPlayerId: "alice",
    });

    // Battle immediate effect の stack 解決後に、remainingStacks が空の marker
    // だけが残った実リプレイの状態を最小化して再現する。
    const stuckBeforeFix: GameState = {
      ...forcedBlockWindow,
      pendingStackCascade: { remainingStacks: [] },
      pendingResolutionEndLogs: ["battle:immediate:resolve:end:edh-0007"],
    };
    const pass = getLegalActions({
      state: stuckBeforeFix,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => [],
    }).find((action) => action.kind === "pass_pre_declaration_stack");
    expect(pass).toBeDefined();

    const resolved = applyLegalAction({
      state: stuckBeforeFix,
      action: pass!,
      getCardDefinitionById,
    }).state;

    expect(resolved.pendingStackCascade).toBeNull();
    expect(resolved.pendingPreDeclarationConfirmation).toBeNull();
    expect(resolved.window).toBe("declare_block");
    expect(
      resolved.activeAttack?.blockAssignments[0]?.blockedByEntityIds
    ).toEqual(["battle-entity:target-1"]);
    expect(resolved.pendingResolutionEndLogs).toEqual([]);
    expect(resolved.log).toContain("battle:immediate:resolve:end:edh-0007");
  });

  it("EDH-0084: 発揮前誘発を辞退した通常マジックの cost leave は block 宣言の確定を止めない", () => {
    const declared = buildDesignatedAttackDeclaredState();
    const forcedBlockWindow =
      maybeFinalizeDesignatedAttackAfterPendingReactions(declared, {
        getCardDefinitionById,
      });
    // 元 replay と同じ、未無効化の通常マジックを解決させる。isNullified
    // の discard-only 経路ではなく、deferred magic resolver の live 経路を通す。
    const magic = createCardInstance(BSFT01_TR11_A, {
      instanceId: "edh-0084-magic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const costSource = createCardInstance(ATTACKER, {
      instanceId: "edh-0084-cost-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
      pendingLeaveKind: "vanish",
      pendingLeaveCause: "cost_payment",
      pendingLeaveChainId: "magic:edh-0084",
      deferZoneMoveUntilChainEnd: true,
    });
    const skippedMagicStack: ActiveStack = {
      stackId: "stack:magic:edh-0084",
      actionKind: "magic",
      chainId: "magic:edh-0084",
      actingPlayerId: "alice",
      cardInstanceId: magic.instanceId,
      cardDefinitionId: BSFT01_TR11_A.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: [],
      reducedCost: 0,
      totalReduction: 0,
      chosenTiming: "flash",
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
      // This is the state after the effect-declaration trigger was declined.
      effectDeclarationTriggerQueued: true,
    };
    const definitionMap = new Map<string, CardDefinition>([
      [ATTACKER.cardNo, ATTACKER],
      [TARGET.cardNo, TARGET],
      [BSFT01_TR11_A.cardNo, BSFT01_TR11_A],
    ]);
    const delayedState: GameState = {
      ...forcedBlockWindow,
      cardInstances: [...forcedBlockWindow.cardInstances, magic, costSource],
      pendingLeaveEntities: [
        {
          instanceId: costSource.instanceId,
          kind: "vanish",
          cause: "cost_payment",
          causePlayerId: "alice",
          chainId: skippedMagicStack.chainId,
          deferZoneMoveUntilChainEnd: true,
        },
      ],
      pendingStackCascade: {
        remainingStacks: [skippedMagicStack],
        waitForTriggeredEffects: true,
      },
    };
    const pass = getLegalActions({
      state: delayedState,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => definitionMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
    }).find((action) => action.kind === "pass_pre_declaration_stack");
    expect(pass).toBeDefined();

    const resolved = applyLegalAction({
      state: delayedState,
      action: pass!,
      getCardDefinitionById: (id) => definitionMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    // 実マジックの body を通った結果、後続の任意処理が現れる。
    // （nullified の discard-only 経路ではなく live deferred resolver を通った証拠。）
    expect(resolved.pendingStackCascade).toBeNull();
    expect(resolved.pendingPreDeclarationConfirmation).toMatchObject({
      kind: "forced_block",
    });
    expect(resolved.pendingStepOptionalChoice).toMatchObject({
      sourceDefinitionId: BSFT01_TR11_A.cardNo,
      stepLabel: "rebirth_window",
    });

    const declineRebirth = getLegalActions({
      state: resolved,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => definitionMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "decline"
    );
    expect(declineRebirth).toBeDefined();
    const afterRebirthDeclined = applyLegalAction({
      state: resolved,
      action: declineRebirth!,
      getCardDefinitionById: (id) => definitionMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(afterRebirthDeclined.pendingStepOptionalChoice).toMatchObject({
      sourceDefinitionId: BSFT01_TR11_A.cardNo,
      stepLabel: "combine_window",
    });

    const declineCombine = getLegalActions({
      state: afterRebirthDeclined,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => definitionMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "decline"
    );
    expect(declineCombine).toBeDefined();
    const afterMagicResolved = applyLegalAction({
      state: afterRebirthDeclined,
      action: declineCombine!,
      getCardDefinitionById: (id) => definitionMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    expect(afterMagicResolved.pendingStepOptionalChoice).toBeNull();
    expect(afterMagicResolved.pendingStackCascade).toBeNull();
    expect(
      afterMagicResolved.cardInstances.find(
        (card) => card.instanceId === magic.instanceId
      )?.zone
    ).toBe("trash");
    expect(afterMagicResolved.pendingLeaveEntities).toEqual([]);
    expect(afterMagicResolved.pendingPreDeclarationConfirmation).toBeNull();
    expect(afterMagicResolved.window).toBe("declare_block");
    expect(
      afterMagicResolved.activeAttack?.blockAssignments[0]?.blockedByEntityIds
    ).toEqual(["battle-entity:target-1"]);
  });

  it("EDH-0008: 待機バーストの effect-declaration stack を閉じるまで forced_block を確定しない", () => {
    const declared = buildDesignatedAttackDeclaredState();
    const forcedBlockWindow =
      maybeFinalizeDesignatedAttackAfterPendingReactions(declared, {
        getCardDefinitionById,
      });
    const burst = createCardInstance(BSTH03_M04, {
      instanceId: "edh-0008-burst",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "burst",
    });
    const burstCheck = {
      checkId: "burst:edh-0008:leave-field",
      actingPlayerId: "bob",
      eventKind: "leave_field" as const,
      event: {
        family: "leave_field" as const,
        validationMode: "snapshot_only" as const,
      },
      source: "action_resolution" as const,
      chainId: "battle-immediate:edh-0008",
      attackId: null,
      relatedPlayerId: "bob",
      relatedInstanceId: "target-1",
      amount: 1,
      step: "attack" as const,
      window: "pre_declaration_stack" as const,
      resolvedBurstCardInstanceIds: [],
      activationSelected: true,
    };
    const delayedBurstStack = {
      stackId: "stack:burst:edh-0008",
      actionKind: "burst_activation" as const,
      chainId: burstCheck.chainId,
      actingPlayerId: "bob",
      cardInstanceId: burst.instanceId,
      cardDefinitionId: BSTH03_M04.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: [],
      burstCheckId: burstCheck.checkId,
      burstPendingSnapshot: burstCheck,
      burstSourceKind: "spirit" as const,
      burstRegistrationIndex: 0,
      burstEffectDeclarationPending: true,
      burstEffectDeclarationPreviousWindow: "pre_declaration_stack" as const,
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };
    const definitionMap = new Map<string, CardDefinition>([
      [ATTACKER.cardNo, ATTACKER],
      [TARGET.cardNo, TARGET],
      [BSTH03_M04.cardNo, BSTH03_M04],
    ]);
    const delayedState: GameState = {
      ...forcedBlockWindow,
      cardInstances: [...forcedBlockWindow.cardInstances, burst],
      pendingBurstChecks: [burstCheck],
      pendingStackCascade: {
        remainingStacks: [delayedBurstStack],
        waitForTriggeredEffects: true,
      },
    };
    const effectOptions = {
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: buildBurstEffectLookup([BSTH03_M04]),
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredHandActivatedEffectActions: () => [],
      getRegisteredMagicActions: () => [],
    };
    const pass = getLegalActions({
      state: delayedState,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => definitionMap.get(id),
      ...effectOptions,
    }).find((action) => action.kind === "pass_pre_declaration_stack");
    expect(pass).toBeDefined();

    const afterPass = applyLegalAction({
      state: delayedState,
      action: pass!,
      getCardDefinitionById: (id) => definitionMap.get(id),
      ...effectOptions,
    }).state;

    expect(afterPass.window).toBe("stack");
    expect(afterPass.stackWindow?.burstWindowKind).toBe("effect_declaration");
    expect(afterPass.pendingPreDeclarationConfirmation).toMatchObject({
      kind: "forced_block",
      sourceInstanceId: "target-1",
    });
    expect(afterPass.pendingBurstChecks).toHaveLength(1);
    expect(
      afterPass.activeAttack?.blockAssignments[0]?.blockedByEntityIds
    ).toEqual([]);

    const effectDeclarationPass = getLegalActions({
      state: afterPass,
      actingPlayerId: afterPass.stackWindow!.priorityPlayerId,
      getCardDefinitionById: (id) => definitionMap.get(id),
      ...effectOptions,
    }).find((action) => action.kind === "pass_stack");
    expect(effectDeclarationPass).toBeDefined();

    const afterEffectDeclarationPass = applyLegalAction({
      state: afterPass,
      action: effectDeclarationPass!,
      getCardDefinitionById: (id) => definitionMap.get(id),
      ...effectOptions,
    }).state;
    const resolveBurstTarget = getLegalActions({
      state: afterEffectDeclarationPass,
      actingPlayerId:
        afterEffectDeclarationPass.pendingEffectTargetSelection!.actingPlayerId,
      getCardDefinitionById: (id) => definitionMap.get(id),
      ...effectOptions,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(resolveBurstTarget).toBeDefined();

    const afterBurstTargets = applyLegalAction({
      state: afterEffectDeclarationPass,
      action: resolveBurstTarget!,
      targetInstanceIds: ["attacker-1"],
      getCardDefinitionById: (id) => definitionMap.get(id),
      ...effectOptions,
    }).state;
    expect(afterBurstTargets.pendingMultiPlacement).not.toBeNull();
    expect(afterBurstTargets.pendingPreDeclarationConfirmation?.kind).toBe(
      "forced_block"
    );
    const placement = getLegalActions({
      state: afterBurstTargets,
      actingPlayerId: "bob",
      getCardDefinitionById: (id) => definitionMap.get(id),
      ...effectOptions,
    }).find((action) => action.kind === "resolve_pending_multi_placement");
    expect(placement).toBeDefined();
    const afterBurstResolution = applyLegalAction({
      state: afterBurstTargets,
      action: placement!,
      multiPlacementAllocations: [
        {
          destinationInstanceId: "edh-0008-burst",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
      getCardDefinitionById: (id) => definitionMap.get(id),
      ...effectOptions,
    }).state;

    // バーストの target 選択と本体解決が終わるまでは deferred だった forced_block が、
    // この一点でちょうど一度だけ確定する。stack window を先に閉じただけでは確定しない
    // ことと、すべての待機状態を drain してから確定することを両方検証する。
    expect(afterBurstResolution.stackWindow).toBeNull();
    expect(afterBurstResolution.pendingEffectTargetSelection).toBeNull();
    expect(afterBurstResolution.pendingBurstChecks).toEqual([]);
    expect(afterBurstResolution.pendingPreDeclarationConfirmation).toBeNull();
    expect(afterBurstResolution.window).toBe("declare_block");
    expect(afterBurstResolution.activeAttack?.blockAssignments).toEqual([
      {
        participantEntityId: "battle-entity:attacker-1",
        blockedByEntityIds: ["battle-entity:target-1"],
      },
    ]);
    expect(
      afterBurstResolution.cardInstances.find(
        (card) => card.instanceId === "edh-0008-burst"
      )?.zone
    ).toBe("field");
  });

  it("BSTH03-転醒R01(A) の任意疲労誘発を辞退すると、最後の pending drain 後に強制ブロック窓へ進む", () => {
    const declared = buildDesignatedAttackDeclaredState();
    const source = createCardInstance(BSTH03_TENSEI_R01_A, {
      instanceId: "tensei-nexus-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "nexus",
    });
    const defs = [ATTACKER, TARGET, BSTH03_TENSEI_R01_A];
    const definitionMap = new Map(
      defs.map((definition) => [definition.cardNo, definition])
    );
    const getDefinition = (id: string) => definitionMap.get(id);
    const triggeredLookup = buildTriggeredEffectLookup(defs);
    const state: GameState = {
      ...declared,
      cardInstances: [...declared.cardInstances, source],
      pendingTriggeredEffects: [
        {
          pendingId: "pending:bsth03-tensei-exhaust",
          actingPlayerId: "bob",
          eventKind: "exhaust",
          event: {
            family: "state_change",
            actionKind: "exhaust",
            validationMode: "require_related_instance_on_field",
            cause: "self_effect",
          },
          source: "action_resolution",
          chainId: "test:designated-attack-burst-finalization:575",
          attackId: declared.activeAttack!.attackId,
          relatedPlayerId: "alice",
          relatedInstanceId: "attacker-1",
          amount: null,
          step: "attack",
          window: "declare_attack",
          resolvedSourceInstanceIds: [],
          cause: "self_effect",
          relatedInstanceIds: ["attacker-1"],
          relatedInstanceIdsBySourceRegistrationKey: {
            "tensei-nexus-1#0": ["attacker-1"],
          },
        },
      ],
    };

    const resolve = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "tensei-nexus-1"
    );
    expect(resolve).toBeDefined();
    if (!resolve || resolve.kind !== "resolve_pending_triggered_effect") {
      throw new Error("expected optional BSTH03-転醒R01(A) resolve action");
    }

    const skipped = applyLegalAction({
      state,
      action: resolve,
      skipOptionalEffect: true,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    expect(skipped.pendingTriggeredEffects).toHaveLength(0);
    expect(skipped.preDeclarationStackWindow).toMatchObject({
      kind: "forced_block",
      sourceInstanceId: "target-1",
      actingPlayerId: "bob",
      priorityPlayerId: "alice",
    });
    expect(skipped.window).toBe("pre_declaration_stack");
  });

  it("BSTH03-転醒R01(A) を同時誘発から選んで辞退した後も、残る pending を drain すれば強制ブロック窓へ進む", () => {
    const declared = buildDesignatedAttackDeclaredState();
    const source = createCardInstance(BSTH03_TENSEI_R01_A, {
      instanceId: "tensei-nexus-queue-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
    });
    const defs = [ATTACKER, TARGET, BSTH03_TENSEI_R01_A];
    const definitionMap = new Map(
      defs.map((definition) => [definition.cardNo, definition])
    );
    const getDefinition = (id: string) => definitionMap.get(id);
    const triggeredLookup = buildTriggeredEffectLookup(defs);
    const state: GameState = {
      ...declared,
      cardInstances: [...declared.cardInstances, source],
      pendingTriggeredEffects: ["first", "second"].map((suffix) => ({
        pendingId: `pending:bsth03-tensei-simultaneous:${suffix}`,
        actingPlayerId: "alice",
        eventKind: "exhaust",
        event: {
          family: "state_change",
          actionKind: "exhaust",
          validationMode: "require_related_instance_on_field",
          cause: "self_effect",
        },
        source: "action_resolution",
        chainId: "test:designated-attack-burst-finalization:653",
        attackId: declared.activeAttack!.attackId,
        relatedPlayerId: "alice",
        relatedInstanceId: "attacker-1",
        amount: null,
        step: "attack",
        window: "declare_attack",
        resolvedSourceInstanceIds: [],
        cause: "self_effect",
        relatedInstanceIds: ["attacker-1"],
        relatedInstanceIdsBySourceRegistrationKey: {
          "tensei-nexus-queue-1#0": ["attacker-1"],
        },
      })),
    };

    const select = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (action) =>
        action.kind === "select_pending_to_resolve" &&
        action.pendingId === "pending:bsth03-tensei-simultaneous:first"
    );
    expect(select).toBeDefined();
    if (!select || select.kind !== "select_pending_to_resolve") {
      throw new Error("expected simultaneous pending selection action");
    }

    const afterSelectedSkip = applyLegalAction({
      state,
      action: select,
      skipOptionalEffect: true,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    expect(afterSelectedSkip.pendingTriggeredEffects).toHaveLength(1);
    expect(afterSelectedSkip.window).toBe("declare_attack");

    const resolveRemaining = getLegalActions({
      state: afterSelectedSkip,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find((action) => action.kind === "resolve_pending_triggered_effect");
    expect(resolveRemaining).toBeDefined();
    if (
      !resolveRemaining ||
      resolveRemaining.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected remaining optional resolve action");
    }

    const drained = applyLegalAction({
      state: afterSelectedSkip,
      action: resolveRemaining,
      skipOptionalEffect: true,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    expect(drained.pendingTriggeredEffects).toHaveLength(0);
    expect(drained.preDeclarationStackWindow).toMatchObject({
      kind: "forced_block",
      sourceInstanceId: "target-1",
      actingPlayerId: "bob",
      priorityPlayerId: "alice",
    });
    expect(drained.window).toBe("pre_declaration_stack");
  });
});
