/**
 * `EffectStep.executionMode === "optional"` の step 自身が独自 target を持つときの
 * プレイヤー対象選択窓 (PendingStepOptionalTargetSelection) のテスト。
 *
 * 「前段は強制実行、後段は任意で対象1体」effect (BSGE01-C06 effects[1] step2
 * 「疲労状態の相手のスピリット/アルティメット1体をデッキの下に戻せる」型) で、
 * execute 後に engine が pool.slice で機械選択するのを抑止し、候補が2件以上あるとき
 * プレイヤー選択窓を立てて対象1体を選ばせる経路を verify する。
 *
 * 正源: needs-dsl.audit ENGINE-step-optional-target-step-pending-selection。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildBurstEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import type {
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src";

// 「相手1体をデッキ下に戻す。さらに、相手1体を**手札に戻せる**。」型: step0 mandatory + step1 optional with own target。
const optionalSecondTargetMagic: CardDefinition = {
  cardNo: "TEST-OPTIONAL-SECOND-TARGET",
  name: "テスト・任意 2 段対象",
  printedCategory: "magic",
  colors: ["white"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [
    "メイン",
    "相手のスピリット1体をデッキの下に戻す。さらに、相手のスピリット1体を手札に戻せる。",
  ],
  keywordTags: [],
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "mandatory-deck",
          action: {
            kind: "send_to_deck",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
            position: "bottom",
          },
        },
        {
          id: "optional-bounce",
          executionMode: "optional",
          action: {
            kind: "bounce",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
          },
          connector: "simultaneous",
        },
      ],
    },
  ],
  sourceUrls: [],
  sourceConfidence: "C",
};

const optionalExcludeStepTargetMagic: CardDefinition = {
  cardNo: "TEST-OPTIONAL-EXCLUDE-STEP-TARGET",
  name: "テスト・任意 前段対象除外",
  printedCategory: "magic",
  colors: ["white"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [
    "メイン",
    "相手のスピリット1体を指定する。その後、指定した対象以外の相手のスピリット1体を手札に戻せる。",
  ],
  keywordTags: [],
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "designated",
          action: {
            kind: "noop",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
          },
        },
        {
          id: "optional-bounce-excluding-designated",
          executionMode: "optional",
          action: {
            kind: "bounce",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
              excludeStepId: "designated",
            },
          },
        },
      ],
    },
  ],
  sourceUrls: [],
  sourceConfidence: "C",
};

const enemySpirit: CardDefinition = {
  cardNo: "TEST-ENEMY-SPIRIT",
  name: "敵スピリット",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const handTargetedResponder: CardDefinition = {
  ...enemySpirit,
  cardNo: "TEST-OPTIONAL-TARGETED-HAND-RESPONDER",
  name: "任意対象への手札誘発",
  textLines: ["自分のカードが相手の効果の対象になったとき、カウント+1できる。"],
  effects: [
    {
      timing: { kind: "game_event", event: "targeted", player: "self" },
      applicability: { zone: "hand" },
      executionMode: "optional",
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    },
  ],
};

const preventionNexus: CardDefinition = {
  cardNo: "TEST-PREVENTION-NEXUS",
  name: "防止ネクサス",
  printedCategory: "nexus",
  colors: ["yellow"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0 }],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const defs = [
  optionalSecondTargetMagic,
  optionalExcludeStepTargetMagic,
  enemySpirit,
  preventionNexus,
];
const map = new Map(defs.map((d) => [d.cardNo, d]));
const getCardDefinitionById = (id: string) => map.get(id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
};

function baseState(): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
  });
  return {
    ...base,
    activePlayerId: "alice",
    step: "main",
    cardInstances: [
      createCardInstance(optionalSecondTargetMagic, {
        instanceId: "magic-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(enemySpirit, {
        instanceId: "enemy-1",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(enemySpirit, {
        instanceId: "enemy-2",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(enemySpirit, {
        instanceId: "enemy-3",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
  };
}

function runEffect(state: GameState): GameState {
  return executeEffect({
    chainId: "test:step-optional-target-selection:231",
    state,
    effect: optionalSecondTargetMagic.effects![0]!,
    effectIndex: 0,
    sourceInstanceId: "magic-1",
    actingPlayerId: "alice",
    // 宣言時 target を step0 (mandatory) 用に注入 (registration 経路の擬似)。
    targetInstanceIds: ["enemy-1"],
    targetStepId: "mandatory-deck",
    ...lookups,
  });
}

function zoneOf(state: GameState, instanceId: string): string | undefined {
  return state.cardInstances.find((c) => c.instanceId === instanceId)?.zone;
}

function defenseImmuneFromNexusCE(targetInstanceId: string): ContinuousEffect {
  return {
    effectId: `test-defense-immune-${targetInstanceId}`,
    sourceInstanceId: "prevention-nexus-1",
    sourceDefinitionId: preventionNexus.cardNo,
    actingPlayerId: "bob",
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "defense_immune" as ContinuousEffectTag,
    targetInstanceId,
    metadata: { source: "opponent_effect" },
  };
}

describe("pendingStepOptionalTargetSelection: optional step 自身の対象選択", () => {
  it("optional step 到達で execute/decline pending が立つ", () => {
    const after = runEffect(baseState());
    expect(after.pendingStepOptionalChoice).not.toBeNull();
    expect(after.pendingStepOptionalChoice!.stepIndex).toBe(1);
    // step0 (deck 戻し) は実行済みだが、optional execute/decline 待ちの
    // 継続が残る間は pending leave のまま実移動しない。
    expect(zoneOf(after, "enemy-1")).toBe("field");
    expect(after.pendingLeaveEntities).toHaveLength(1);
    // optional target 選択は未だ立たない (まだ execute/decline 未解決)。
    expect(after.pendingStepOptionalTargetSelection).toBeNull();
  });

  it("execute 解決時、候補2件以上なら pendingStepOptionalTargetSelection を立てる", () => {
    const pendingState = runEffect(baseState());
    const psoc = pendingState.pendingStepOptionalChoice!;
    const resolved = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "execute",
      },
      ...lookups,
    }).state;
    // 元 pending はクリア、新 pending が立つ。
    expect(resolved.pendingStepOptionalChoice).toBeNull();
    const target = resolved.pendingStepOptionalTargetSelection;
    expect(target).not.toBeNull();
    expect(target!.actingPlayerId).toBe("alice");
    expect(target!.requiredTargetCount).toBe(1);
    expect(target!.maxTargetCount).toBe(1);
    expect(target!.candidateInstanceIds.sort()).toEqual(
      ["enemy-2", "enemy-3"].sort()
    );
    expect(target!.targetStepId).toBe("optional-bounce");
    // step1 (bounce) は未実行: enemy-2/3 は field のまま。
    expect(zoneOf(resolved, "enemy-2")).toBe("field");
    expect(zoneOf(resolved, "enemy-3")).toBe("field");
  });

  it("optional step の target.excludeStepId は前段で指定した対象を候補から除外する", () => {
    const base = baseState();
    const state = executeEffect({
      chainId: "test:step-optional-target-selection:313",
      state: {
        ...base,
        cardInstances: [
          createCardInstance(optionalExcludeStepTargetMagic, {
            instanceId: "exclude-magic",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          ...base.cardInstances.filter((card) => card.instanceId !== "magic-1"),
        ],
      },
      effect: optionalExcludeStepTargetMagic.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "exclude-magic",
      actingPlayerId: "alice",
      targetInstanceIds: ["enemy-1"],
      targetStepId: "designated",
      ...lookups,
    });
    const psoc = state.pendingStepOptionalChoice!;
    const afterExecute = applyLegalAction({
      state,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "execute",
      },
      ...lookups,
    }).state;
    const target = afterExecute.pendingStepOptionalTargetSelection;
    expect(target).not.toBeNull();
    expect(target!.targetStepId).toBe("optional-bounce-excluding-designated");
    expect(target!.candidateInstanceIds).not.toContain("enemy-1");
    expect(target!.candidateInstanceIds.sort()).toEqual(
      ["enemy-2", "enemy-3"].sort()
    );
  });

  it("getLegalActions が resolve_pending_step_optional_target_selection を提示する", () => {
    const pendingState = runEffect(baseState());
    const psoc = pendingState.pendingStepOptionalChoice!;
    const afterExecute = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "execute",
      },
      ...lookups,
    }).state;
    const actions = getLegalActions({
      state: afterExecute,
      actingPlayerId: "alice",
      ...lookups,
    });
    const psots = actions.find(
      (a) => a.kind === "resolve_pending_step_optional_target_selection"
    );
    expect(psots).toBeDefined();
    expect(psots!.candidateTargetInstanceIds.sort()).toEqual(
      ["enemy-2", "enemy-3"].sort()
    );
  });

  it("プレイヤーが選んだ対象のみが bounce される", () => {
    const pendingState = runEffect(baseState());
    const psoc = pendingState.pendingStepOptionalChoice!;
    const afterExecute = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "execute",
      },
      ...lookups,
    }).state;
    const psots = afterExecute.pendingStepOptionalTargetSelection!;
    const resolved = applyLegalAction({
      state: afterExecute,
      action: {
        kind: "resolve_pending_step_optional_target_selection",
        actionId: `psots-${psots.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: psots.actingPlayerId,
        pendingId: psots.pendingId,
        sourceInstanceId: psots.sourceInstanceId,
        sourceDefinitionId: psots.sourceDefinitionId,
        effectIndex: psots.effectIndex,
        stepIndex: psots.stepIndex,
        requiredTargetCount: psots.requiredTargetCount,
        maxTargetCount: psots.maxTargetCount,
        candidateTargetInstanceIds: psots.candidateInstanceIds,
      },
      targetInstanceIds: ["enemy-3"],
      ...lookups,
    }).state;
    expect(resolved.pendingStepOptionalTargetSelection).toBeNull();
    // 選択した enemy-3 は hand へ、未選択 enemy-2 は field のまま。
    expect(zoneOf(resolved, "enemy-3")).toBe("hand");
    expect(zoneOf(resolved, "enemy-2")).toBe("field");
  });

  it("optional target の private targeted responder を skip 後に、同じ optional step を再提示せず解決する", () => {
    const outerBurst = ALL_CARDS.find(
      (definition) => definition.cardNo === "BSTH003-X02"
    )!;
    const optionalTargetOnlyMagic: CardDefinition = {
      ...optionalSecondTargetMagic,
      cardNo: "TEST-OPTIONAL-TARGET-ONLY",
      name: "テスト・任意対象のみ",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "optional-bounce-only",
              executionMode: "optional",
              action: {
                kind: "bounce",
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
    };
    const privateDefs = [
      optionalTargetOnlyMagic,
      enemySpirit,
      handTargetedResponder,
      outerBurst,
    ];
    const privateMap = new Map(
      privateDefs.map((definition) => [definition.cardNo, definition])
    );
    const privateLookups = {
      getCardDefinitionById: (id: string) => privateMap.get(id),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(privateDefs),
      getRegisteredBurstActions: buildBurstEffectLookup([outerBurst]),
      getRegisteredFieldCardEffectActions: () => [],
    };
    const outerBurstState: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      cardInstances: [
        createCardInstance(outerBurst, {
          instanceId: "outer-burst-1",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "burst",
        }),
        createCardInstance(outerBurst, {
          instanceId: "outer-burst-2",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "burst",
        }),
      ],
      setBurstStates: [
        { playerId: "bob", cardInstanceId: "outer-burst-1" },
        { playerId: "bob", cardInstanceId: "outer-burst-2" },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:test-outer:first",
          actingPlayerId: "bob",
          eventKind: "attack_after",
          source: "battle_resolution",
          chainId: "test:step-optional-target-selection:507",
          attackId: "attack:test-outer",
          relatedPlayerId: "alice",
          amount: 0,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
        {
          checkId: "burst:test-outer:second",
          actingPlayerId: "bob",
          eventKind: "attack_after",
          source: "battle_resolution",
          chainId: "test:step-optional-target-selection:520",
          attackId: "attack:test-outer",
          relatedPlayerId: "alice",
          amount: 0,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    };
    const outerBurstAction = getLegalActions({
      state: outerBurstState,
      actingPlayerId: "bob",
      ...privateLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_burst_check" &&
        action.sourceInstanceId === "outer-burst-1"
    );
    expect(outerBurstAction).toBeDefined();
    const afterFirstOuterBurstDeclaration = applyLegalAction({
      state: outerBurstState,
      action: outerBurstAction!,
      ...privateLookups,
    }).state;
    expect(
      afterFirstOuterBurstDeclaration.pendingStackCascade?.remainingStacks[0]
        ?.burstActivationWindowPending
    ).toBe(true);
    const secondOuterBurstAction = getLegalActions({
      state: afterFirstOuterBurstDeclaration,
      actingPlayerId: "bob",
      ...privateLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_burst_check" &&
        action.sourceInstanceId === "outer-burst-2"
    );
    expect(secondOuterBurstAction).toBeDefined();
    const afterOuterBurstDeclaration = applyLegalAction({
      state: afterFirstOuterBurstDeclaration,
      action: secondOuterBurstAction!,
      ...privateLookups,
    }).state;
    expect(afterOuterBurstDeclaration.stackWindow?.burstWindowKind).toBe(
      "activation"
    );
    expect(afterOuterBurstDeclaration.pendingBurstChecks).toContainEqual(
      expect.objectContaining({
        checkId: "burst:test-outer:first",
        activationSelected: true,
      })
    );
    const pendingState = executeEffect({
      chainId: "test:step-optional-target-selection:578",
      state: {
        ...afterOuterBurstDeclaration,
        cardInstances: [
          ...afterOuterBurstDeclaration.cardInstances,
          createCardInstance(optionalTargetOnlyMagic, {
            instanceId: "private-target-magic",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(enemySpirit, {
            instanceId: "enemy-1",
            ownerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(enemySpirit, {
            instanceId: "enemy-2",
            ownerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(handTargetedResponder, {
            instanceId: "bob-hand-targeted-responder",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
        ],
      },
      effect: optionalTargetOnlyMagic.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "private-target-magic",
      actingPlayerId: "alice",
      ...privateLookups,
    });
    const optionalChoice = pendingState.pendingStepOptionalChoice!;
    const afterExecute = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${optionalChoice.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: optionalChoice.actingPlayerId,
        pendingId: optionalChoice.pendingId,
        sourceInstanceId: optionalChoice.sourceInstanceId,
        effectIndex: optionalChoice.effectIndex,
        stepIndex: optionalChoice.stepIndex,
        choice: "execute",
      },
      ...privateLookups,
    }).state;
    const targetSelection = afterExecute.pendingStepOptionalTargetSelection!;
    const afterTargetSelection = applyLegalAction({
      state: afterExecute,
      action: {
        kind: "resolve_pending_step_optional_target_selection",
        actionId: `psots-${targetSelection.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: targetSelection.actingPlayerId,
        pendingId: targetSelection.pendingId,
        sourceInstanceId: targetSelection.sourceInstanceId,
        sourceDefinitionId: targetSelection.sourceDefinitionId,
        effectIndex: targetSelection.effectIndex,
        stepIndex: targetSelection.stepIndex,
        requiredTargetCount: targetSelection.requiredTargetCount,
        maxTargetCount: targetSelection.maxTargetCount,
        candidateTargetInstanceIds: targetSelection.candidateInstanceIds,
      },
      targetInstanceIds: ["enemy-2"],
      ...privateLookups,
    }).state;
    expect(afterTargetSelection.pendingPrivateDeclarations).toHaveLength(1);
    // 実際の resolve_pending_burst_check 経路で選択済みになった外側バーストの
    // activation stack 中でも、対象開示への private responder を消化したら
    // 内側 effect を先に再開する。
    const skipAction = getLegalActions({
      state: afterTargetSelection,
      actingPlayerId: "bob",
      ...privateLookups,
    }).find((action) => action.kind === "skip_private_triggered_effect");
    expect(skipAction).toBeDefined();

    const resolved = applyLegalAction({
      state: afterTargetSelection,
      action: skipAction!,
      ...privateLookups,
    }).state;

    // 2 枚の実バーストの応答窓と維持コア配置を解決し、
    // delayed stack を含む外側処理が leave flush まで到達することを確認する。
    let settled = resolved;
    for (let index = 0; index < 16; index += 1) {
      const passAction = ["alice", "bob"]
        .flatMap((actingPlayerId) =>
          getLegalActions({
            state: settled,
            actingPlayerId,
            ...privateLookups,
          })
        )
        .find(
          (action) =>
            action.kind === "pass_stack" ||
            action.kind === "resolve_pending_multi_placement"
        );
      if (!passAction) break;
      settled = applyLegalAction({
        state: settled,
        action: passAction,
        ...(settled.pendingMultiPlacement
          ? {
              multiPlacementAllocations:
                settled.pendingMultiPlacement.targets.map((target) => ({
                  destinationInstanceId: target.instanceId,
                  placements: [
                    {
                      kind: "reserve_normal" as const,
                      amount: target.minimumCoreCount,
                    },
                  ],
                })),
            }
          : {}),
        ...privateLookups,
      }).state;
    }

    expect(settled.pendingPrivateDeclarations).toHaveLength(0);
    expect(settled.pendingTargetedDisclosureContinuation).toBeNull();
    expect(settled.pendingStepOptionalChoice).toBeNull();
    expect(settled.pendingStepOptionalTargetSelection).toBeNull();
    expect(settled.pendingBurstChecks).toHaveLength(0);
    expect(settled.pendingStackCascade).toBeNull();
    expect(settled.pendingLeaveEntities).not.toContainEqual(
      expect.objectContaining({ instanceId: "enemy-2" })
    );
    expect(zoneOf(settled, "enemy-2")).toBe("hand");
    expect(
      settled.log.filter((entry) =>
        entry.startsWith("effect:target-disclosure:queued:")
      )
    ).toHaveLength(1);
  });

  it("optional core_distribute は action.to を対象選択として扱い、選んだ対象だけへ one_each 配置する", () => {
    const optionalCoreDistributeMagic: CardDefinition = {
      cardNo: "TEST-OPTIONAL-CORE-DISTRIBUTE",
      name: "テスト・任意コア配分",
      printedCategory: "magic",
      colors: ["green"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [
        "メイン",
        "自分のスピリット3体にボイドからコア1個ずつ置ける。",
      ],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "optional-core-distribute",
              executionMode: "optional",
              action: {
                kind: "core_distribute",
                from: { kind: "void", player: "self" },
                to: {
                  kind: "filter",
                  player: "self",
                  filter: { category: ["spirit"], tribes: ["CB"] },
                  count: 3,
                },
                amount: 3,
                mode: "one_each",
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const cbSpirit: CardDefinition = {
      ...enemySpirit,
      cardNo: "TEST-OPTIONAL-CB-SPIRIT",
      name: "任意コア候補",
      colors: ["green"],
      symbolColors: ["green"],
      tribe: "CB",
    };
    const coreDefs = [optionalCoreDistributeMagic, cbSpirit];
    const coreMap = new Map(coreDefs.map((d) => [d.cardNo, d]));
    const coreLookups = {
      getCardDefinitionById: (id: string) => coreMap.get(id),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(coreDefs),
    };
    const targets = [1, 2, 3, 4].map((n) =>
      createCardInstance(cbSpirit, {
        instanceId: `core-target-${n}`,
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(optionalCoreDistributeMagic, {
          instanceId: "core-magic",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        ...targets,
      ],
      playerOverrides: [{ voidNormalCoreCount: 3 }, {}],
    });
    const pendingState = executeEffect({
      chainId: "test:step-optional-target-selection:799",
      state: { ...state, activePlayerId: "alice", step: "main" },
      effect: optionalCoreDistributeMagic.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "core-magic",
      actingPlayerId: "alice",
      ...coreLookups,
    });
    const psoc = pendingState.pendingStepOptionalChoice!;
    const afterExecute = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "execute",
      },
      ...coreLookups,
    }).state;

    const psots = afterExecute.pendingStepOptionalTargetSelection!;
    expect(psots).not.toBeNull();
    expect(psots.targetStepId).toBe("optional-core-distribute");
    expect(psots.requiredTargetCount).toBe(3);
    expect(psots.maxTargetCount).toBe(3);
    expect(psots.candidateInstanceIds.sort()).toEqual(
      [
        "core-target-1",
        "core-target-2",
        "core-target-3",
        "core-target-4",
      ].sort()
    );
    expect(
      afterExecute.players.find((p) => p.id === "alice")!.voidNormalCoreCount
    ).toBe(3);

    const resolved = applyLegalAction({
      state: afterExecute,
      action: {
        kind: "resolve_pending_step_optional_target_selection",
        actionId: `psots-${psots.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: psots.actingPlayerId,
        pendingId: psots.pendingId,
        sourceInstanceId: psots.sourceInstanceId,
        sourceDefinitionId: psots.sourceDefinitionId,
        effectIndex: psots.effectIndex,
        stepIndex: psots.stepIndex,
        requiredTargetCount: psots.requiredTargetCount,
        maxTargetCount: psots.maxTargetCount,
        candidateTargetInstanceIds: psots.candidateInstanceIds,
      },
      targetInstanceIds: ["core-target-2", "core-target-3", "core-target-4"],
      ...coreLookups,
    }).state;

    expect(resolved.pendingStepOptionalTargetSelection).toBeNull();
    expect(
      resolved.players.find((p) => p.id === "alice")!.voidNormalCoreCount
    ).toBe(0);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "core-target-1")!
        .normalCoreCount
    ).toBe(1);
    for (const id of ["core-target-2", "core-target-3", "core-target-4"]) {
      const card = resolved.cardInstances.find((c) => c.instanceId === id)!;
      expect(card.normalCoreCount).toBe(2);
      expect(card.everHadCorePlaced).toBe(true);
    }
  });

  it("decline 解決時は target 選択窓を立てず effect が閉じる", () => {
    const pendingState = runEffect(baseState());
    const psoc = pendingState.pendingStepOptionalChoice!;
    const resolved = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "decline",
      },
      ...lookups,
    }).state;
    expect(resolved.pendingStepOptionalChoice).toBeNull();
    expect(resolved.pendingStepOptionalTargetSelection).toBeNull();
    // bounce は実行されない: enemy-2/3 は field のまま。
    expect(zoneOf(resolved, "enemy-2")).toBe("field");
    expect(zoneOf(resolved, "enemy-3")).toBe("field");
  });

  it("choice variant 解決: choiceIndex>0 で variant 側の target で候補を絞る", () => {
    // BSLH01-C05 同型: default action (destroy 相手1体) + choice (no-target action)。
    // choiceIndex=1 を選んだとき、tryBuild は default ではなく variant 側の action を見るべき。
    // variant が target 無しなら pending を立てない。
    const variantOptionalMagic: CardDefinition = {
      cardNo: "TEST-VARIANT-OPTIONAL",
      name: "テスト・任意 variant",
      printedCategory: "magic",
      colors: ["white"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["メイン", "相手1体を破壊するか自分1枚ドローできる。"],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "variant-step",
              executionMode: "optional",
              action: {
                kind: "bounce",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: 1,
                },
              },
              choice: [{ action: { kind: "draw", count: 1 } }],
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const variantDefs = [variantOptionalMagic, enemySpirit];
    const variantMap = new Map(variantDefs.map((d) => [d.cardNo, d]));
    const variantGetDef = (id: string) => variantMap.get(id);
    const variantLookups = {
      getCardDefinitionById: variantGetDef,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(variantDefs),
    };
    const baseVariant: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ handCount: 0, deckCount: 10 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(variantOptionalMagic, {
          instanceId: "magic-2",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(enemySpirit, {
          instanceId: "v-enemy-1",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(enemySpirit, {
          instanceId: "v-enemy-2",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        ...Array.from({ length: 10 }, (_, i) =>
          createCardInstance(enemySpirit, {
            instanceId: `v-deck-${i}`,
            ownerPlayerId: "alice",
            zone: "deck",
          })
        ),
      ],
    };
    // choiceIndex=1 (variant 側: draw, no target) で実行 → execute 解決時、
    // tryBuild は variant の action を見て target 無し → pending 立てず。
    const pendingState = executeEffect({
      chainId: "test:step-optional-target-selection:987",
      state: baseVariant,
      effect: variantOptionalMagic.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "magic-2",
      actingPlayerId: "alice",
      choiceIndex: 1,
      ...variantLookups,
    });
    expect(pendingState.pendingStepOptionalChoice).not.toBeNull();
    const psoc = pendingState.pendingStepOptionalChoice!;
    expect(psoc.continuation.choiceIndex).toBe(1);
    const resolved = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "execute",
      },
      ...variantLookups,
    }).state;
    // variant 側は target 無し → pendingStepOptionalTargetSelection は立たない。
    expect(resolved.pendingStepOptionalTargetSelection).toBeNull();
    // 敵スピリットは field のまま (bounce はかからない)。
    expect(zoneOf(resolved, "v-enemy-1")).toBe("field");
    expect(zoneOf(resolved, "v-enemy-2")).toBe("field");
    // draw (+1) で alice の手札が増えている。
    expect(
      resolved.players.find((p) => p.id === "alice")!.handCount
    ).toBeGreaterThan(0);
  });

  it("step.chooser='opponent' のとき pending の choosingPlayerId は相手プレイヤー", () => {
    // 「相手は自分のスピリット1体を選び、デッキの下に戻せる」型: chooser='opponent'。
    // 対象選択者は相手 (bob)、効果発動者 (acting/source) は alice のまま。
    const opponentChooserMagic: CardDefinition = {
      cardNo: "TEST-OPPONENT-CHOOSER",
      name: "テスト・相手選択",
      printedCategory: "magic",
      colors: ["white"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [
        "メイン",
        "相手は自分のスピリット1体を選び、デッキの下に戻せる。",
      ],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "opponent-choose-bounce",
              executionMode: "optional",
              chooser: "opponent",
              action: {
                kind: "send_to_deck",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: 1,
                },
                position: "bottom",
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const oppDefs = [opponentChooserMagic, enemySpirit];
    const oppMap = new Map(oppDefs.map((d) => [d.cardNo, d]));
    const oppGetDef = (id: string) => oppMap.get(id);
    const oppLookups = {
      getCardDefinitionById: oppGetDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(oppDefs),
    };
    const base: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(opponentChooserMagic, {
          instanceId: "magic-opp",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(enemySpirit, {
          instanceId: "bob-spirit-1",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(enemySpirit, {
          instanceId: "bob-spirit-2",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const pendingState = executeEffect({
      chainId: "test:step-optional-target-selection:1099",
      state: base,
      effect: opponentChooserMagic.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "magic-opp",
      actingPlayerId: "alice",
      ...oppLookups,
    });
    expect(pendingState.pendingStepOptionalChoice).not.toBeNull();
    const psoc = pendingState.pendingStepOptionalChoice!;
    // chooser='opponent' は execute/decline 判断者も相手 (bob) に渡す
    // (ENGINE-step-optional-choice-chooser-opponent)。effect owner = alice は据え置き。
    expect(psoc.actingPlayerId).toBe("alice");
    expect(psoc.choosingPlayerId).toBe("bob");
    // bob 側に execute/decline legal action が提示される。
    const bobChoiceActions = getLegalActions({
      state: pendingState,
      actingPlayerId: "bob",
      ...oppLookups,
    });
    expect(
      bobChoiceActions.find(
        (a) => a.kind === "resolve_pending_step_optional_choice"
      )
    ).toBeDefined();
    // alice 側からは提示されない (current-actor が bob にゲートしている)。
    const aliceChoiceActions = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      ...oppLookups,
    });
    expect(
      aliceChoiceActions.find(
        (a) => a.kind === "resolve_pending_step_optional_choice"
      )
    ).toBeUndefined();
    // alice (= effect owner) が apply しようとすると choosingPlayerId mismatch で reject。
    expect(() =>
      applyLegalAction({
        state: pendingState,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${psoc.pendingId}:execute`,
          can: true,
          reason: "test",
          actingPlayerId: "alice",
          pendingId: psoc.pendingId,
          sourceInstanceId: psoc.sourceInstanceId,
          effectIndex: psoc.effectIndex,
          stepIndex: psoc.stepIndex,
          choice: "execute",
        },
        ...oppLookups,
      })
    ).toThrow(/choosingPlayerId mismatch/);
    // bob が execute を選ぶ。
    const afterExecute = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.choosingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "execute",
      },
      ...oppLookups,
    }).state;
    const psots = afterExecute.pendingStepOptionalTargetSelection;
    expect(psots).not.toBeNull();
    // effect owner = alice、対象選択者 = bob。
    expect(psots!.actingPlayerId).toBe("alice");
    expect(psots!.choosingPlayerId).toBe("bob");
    // bob 側に legal action が提示される (actingPlayerId='bob')。
    const bobActions = getLegalActions({
      state: afterExecute,
      actingPlayerId: "bob",
      ...oppLookups,
    });
    const bobResolve = bobActions.find(
      (a) => a.kind === "resolve_pending_step_optional_target_selection"
    );
    expect(bobResolve).toBeDefined();
    expect(bobResolve!.actingPlayerId).toBe("bob");
    // alice 側からは提示されない (current-actor が bob にゲートしている)。
    const aliceActions = getLegalActions({
      state: afterExecute,
      actingPlayerId: "alice",
      ...oppLookups,
    });
    expect(
      aliceActions.find(
        (a) => a.kind === "resolve_pending_step_optional_target_selection"
      )
    ).toBeUndefined();
    // bob が選んだ対象 (bob-spirit-2) がデッキ下へ。
    const resolved = applyLegalAction({
      state: afterExecute,
      action: {
        kind: "resolve_pending_step_optional_target_selection",
        actionId: `psots-${psots!.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: psots!.choosingPlayerId,
        pendingId: psots!.pendingId,
        sourceInstanceId: psots!.sourceInstanceId,
        sourceDefinitionId: psots!.sourceDefinitionId,
        effectIndex: psots!.effectIndex,
        stepIndex: psots!.stepIndex,
        requiredTargetCount: psots!.requiredTargetCount,
        maxTargetCount: psots!.maxTargetCount,
        candidateTargetInstanceIds: psots!.candidateInstanceIds,
      },
      targetInstanceIds: ["bob-spirit-2"],
      ...oppLookups,
    }).state;
    expect(resolved.pendingStepOptionalTargetSelection).toBeNull();
    expect(zoneOf(resolved, "bob-spirit-2")).toBe("deck");
    expect(zoneOf(resolved, "bob-spirit-1")).toBe("field");
  });

  it("TEST-OPTIONAL-ZERO-TO-N: require=0/max>0 の optional step は 0 体確定で自動選択しない", () => {
    const optionalZeroToNMagic: CardDefinition = {
      cardNo: "TEST-OPTIONAL-ZERO-TO-N",
      name: "テスト・任意 0..N 対象",
      printedCategory: "magic",
      colors: ["white"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["メイン", "相手のスピリット2体までを手札に戻せる。"],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "optional-zero-to-n-bounce",
              executionMode: "optional",
              action: {
                kind: "bounce",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: { min: 0, max: 2 },
                },
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const zeroDefs = [optionalZeroToNMagic, enemySpirit];
    const zeroMap = new Map(zeroDefs.map((d) => [d.cardNo, d]));
    const zeroLookups = {
      getCardDefinitionById: (id: string) => zeroMap.get(id),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(zeroDefs),
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(optionalZeroToNMagic, {
          instanceId: "zero-magic",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(enemySpirit, {
          instanceId: "zero-enemy-1",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(enemySpirit, {
          instanceId: "zero-enemy-2",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const pendingState = executeEffect({
      chainId: "test:step-optional-target-selection:1289",
      state,
      effect: optionalZeroToNMagic.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "zero-magic",
      actingPlayerId: "alice",
      ...zeroLookups,
    });
    const psoc = pendingState.pendingStepOptionalChoice!;
    const afterExecute = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "execute",
      },
      ...zeroLookups,
    }).state;
    const psots = afterExecute.pendingStepOptionalTargetSelection!;
    expect(psots.requiredTargetCount).toBe(0);
    expect(psots.maxTargetCount).toBe(2);
    expect(psots.candidateInstanceIds.sort()).toEqual(
      ["zero-enemy-1", "zero-enemy-2"].sort()
    );

    const resolvedZero = applyLegalAction({
      state: afterExecute,
      action: {
        kind: "resolve_pending_step_optional_target_selection",
        actionId: `psots-${psots.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: psots.actingPlayerId,
        pendingId: psots.pendingId,
        sourceInstanceId: psots.sourceInstanceId,
        sourceDefinitionId: psots.sourceDefinitionId,
        effectIndex: psots.effectIndex,
        stepIndex: psots.stepIndex,
        requiredTargetCount: psots.requiredTargetCount,
        maxTargetCount: psots.maxTargetCount,
        candidateTargetInstanceIds: psots.candidateInstanceIds,
      },
      targetInstanceIds: [],
      ...zeroLookups,
    }).state;
    expect(resolvedZero.pendingStepOptionalTargetSelection).toBeNull();
    expect(zoneOf(resolvedZero, "zero-enemy-1")).toBe("field");
    expect(zoneOf(resolvedZero, "zero-enemy-2")).toBe("field");
  });

  it("TEST-OPTIONAL-COST-BUDGET: optional step 再開経路でも cost budget を pending に伝搬して検証する", () => {
    const makeCostSpirit = (cardNo: string, cost: number): CardDefinition => ({
      cardNo,
      name: cardNo,
      printedCategory: "spirit",
      colors: ["blue"],
      cost,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["blue"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    });
    const cost1 = makeCostSpirit("TEST-COST-1", 1);
    const cost2 = makeCostSpirit("TEST-COST-2", 2);
    const cost3 = makeCostSpirit("TEST-COST-3", 3);
    const optionalCostBudgetMagic: CardDefinition = {
      cardNo: "TEST-OPTIONAL-COST-BUDGET",
      name: "テスト・任意コスト合計",
      printedCategory: "magic",
      colors: ["white"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["メイン", "コスト合計2まで相手のスピリットを手札に戻せる。"],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "optional-cost-budget-bounce",
              executionMode: "optional",
              action: {
                kind: "bounce",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: { min: 0, max: 2 },
                  budget: { metric: "cost", amount: 2 },
                },
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const budgetDefs = [optionalCostBudgetMagic, cost1, cost2, cost3];
    const budgetMap = new Map(budgetDefs.map((d) => [d.cardNo, d]));
    const budgetLookups = {
      getCardDefinitionById: (id: string) => budgetMap.get(id),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(budgetDefs),
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(optionalCostBudgetMagic, {
          instanceId: "budget-magic",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(cost1, {
          instanceId: "budget-cost-1",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(cost2, {
          instanceId: "budget-cost-2",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(cost3, {
          instanceId: "budget-cost-3",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const pendingState = executeEffect({
      chainId: "test:step-optional-target-selection:1436",
      state,
      effect: optionalCostBudgetMagic.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "budget-magic",
      actingPlayerId: "alice",
      ...budgetLookups,
    });
    const psoc = pendingState.pendingStepOptionalChoice!;
    const afterExecute = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "execute",
      },
      ...budgetLookups,
    }).state;
    const psots = afterExecute.pendingStepOptionalTargetSelection!;
    expect(psots.requiredTargetCount).toBe(0);
    expect(psots.maxTargetCount).toBe(2);
    expect(psots.costBudgetAmount).toBe(2);
    expect(psots.candidateInstanceIds.sort()).toEqual(
      ["budget-cost-1", "budget-cost-2", "budget-cost-3"].sort()
    );

    expect(() =>
      applyLegalAction({
        state: afterExecute,
        action: {
          kind: "resolve_pending_step_optional_target_selection",
          actionId: `psots-${psots.pendingId}:over-budget`,
          can: true,
          reason: "test",
          actingPlayerId: psots.actingPlayerId,
          pendingId: psots.pendingId,
          sourceInstanceId: psots.sourceInstanceId,
          sourceDefinitionId: psots.sourceDefinitionId,
          effectIndex: psots.effectIndex,
          stepIndex: psots.stepIndex,
          requiredTargetCount: psots.requiredTargetCount,
          maxTargetCount: psots.maxTargetCount,
          costBudgetAmount: psots.costBudgetAmount,
          candidateTargetInstanceIds: psots.candidateInstanceIds,
        },
        targetInstanceIds: ["budget-cost-1", "budget-cost-2"],
        ...budgetLookups,
      })
    ).toThrow(/cost total 3 exceeds budget 2/);

    const resolved = applyLegalAction({
      state: afterExecute,
      action: {
        kind: "resolve_pending_step_optional_target_selection",
        actionId: `psots-${psots.pendingId}:within-budget`,
        can: true,
        reason: "test",
        actingPlayerId: psots.actingPlayerId,
        pendingId: psots.pendingId,
        sourceInstanceId: psots.sourceInstanceId,
        sourceDefinitionId: psots.sourceDefinitionId,
        effectIndex: psots.effectIndex,
        stepIndex: psots.stepIndex,
        requiredTargetCount: psots.requiredTargetCount,
        maxTargetCount: psots.maxTargetCount,
        costBudgetAmount: psots.costBudgetAmount,
        candidateTargetInstanceIds: psots.candidateInstanceIds,
      },
      targetInstanceIds: ["budget-cost-2"],
      ...budgetLookups,
    }).state;
    expect(resolved.pendingStepOptionalTargetSelection).toBeNull();
    expect(zoneOf(resolved, "budget-cost-2")).toBe("hand");
    expect(zoneOf(resolved, "budget-cost-1")).toBe("field");
    expect(zoneOf(resolved, "budget-cost-3")).toBe("field");
  });

  it("TEST-OPTIONAL-ZERO-TO-N: require=0/max>0 の optional step は選んだ対象だけ解決する", () => {
    const optionalZeroToNMagic: CardDefinition = {
      cardNo: "TEST-OPTIONAL-ZERO-TO-N",
      name: "テスト・任意 0..N 対象",
      printedCategory: "magic",
      colors: ["white"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["メイン", "相手のスピリット2体までを手札に戻せる。"],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "optional-zero-to-n-bounce",
              executionMode: "optional",
              action: {
                kind: "bounce",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: { min: 0, max: 2 },
                },
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const zeroDefs = [optionalZeroToNMagic, enemySpirit];
    const zeroMap = new Map(zeroDefs.map((d) => [d.cardNo, d]));
    const zeroLookups = {
      getCardDefinitionById: (id: string) => zeroMap.get(id),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(zeroDefs),
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(optionalZeroToNMagic, {
          instanceId: "zero-magic",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(enemySpirit, {
          instanceId: "zero-enemy-1",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(enemySpirit, {
          instanceId: "zero-enemy-2",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const pendingState = executeEffect({
      chainId: "test:step-optional-target-selection:1585",
      state,
      effect: optionalZeroToNMagic.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "zero-magic",
      actingPlayerId: "alice",
      ...zeroLookups,
    });
    const psoc = pendingState.pendingStepOptionalChoice!;
    const afterExecute = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "execute",
      },
      ...zeroLookups,
    }).state;
    const psots = afterExecute.pendingStepOptionalTargetSelection!;
    const resolvedOne = applyLegalAction({
      state: afterExecute,
      action: {
        kind: "resolve_pending_step_optional_target_selection",
        actionId: `psots-${psots.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: psots.actingPlayerId,
        pendingId: psots.pendingId,
        sourceInstanceId: psots.sourceInstanceId,
        sourceDefinitionId: psots.sourceDefinitionId,
        effectIndex: psots.effectIndex,
        stepIndex: psots.stepIndex,
        requiredTargetCount: psots.requiredTargetCount,
        maxTargetCount: psots.maxTargetCount,
        candidateTargetInstanceIds: psots.candidateInstanceIds,
      },
      targetInstanceIds: ["zero-enemy-2"],
      ...zeroLookups,
    }).state;
    expect(resolvedOne.pendingStepOptionalTargetSelection).toBeNull();
    expect(zoneOf(resolvedOne, "zero-enemy-1")).toBe("field");
    expect(zoneOf(resolvedOne, "zero-enemy-2")).toBe("hand");
  });

  it("候補数 === 必要数 のとき選択窓は立てず engine 自動採用", () => {
    const onlyOneState: GameState = {
      ...baseState(),
      cardInstances: [
        createCardInstance(optionalSecondTargetMagic, {
          instanceId: "magic-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(enemySpirit, {
          instanceId: "enemy-1",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(enemySpirit, {
          instanceId: "enemy-2",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const pendingState = runEffect(onlyOneState);
    // step0 の deck-bottom 移動は pending leave のまま残る。
    // 残候補は pending leave 中の enemy-1 を除いた enemy-2 のみ。
    expect(zoneOf(pendingState, "enemy-1")).toBe("field");
    expect(pendingState.pendingLeaveEntities).toHaveLength(1);
    const psoc = pendingState.pendingStepOptionalChoice!;
    const resolved = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "execute",
      },
      ...lookups,
    }).state;
    // 候補1件 = 必要数1 で選択余地なし → 選択窓なしで engine 自動採用。
    expect(resolved.pendingStepOptionalTargetSelection).toBeNull();
    expect(zoneOf(resolved, "enemy-2")).toBe("hand");
  });

  it("PendingStepOptionalChoice の候補と作用で sourcePreventionBypass を共有する", () => {
    const protectedState: GameState = {
      ...baseState(),
      activeContinuousEffects: [defenseImmuneFromNexusCE("enemy-2")],
    };

    const noBypassPending = runEffect(protectedState);
    const noBypassChoice = noBypassPending.pendingStepOptionalChoice!;
    const noBypassResolved = applyLegalAction({
      state: noBypassPending,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${noBypassChoice.pendingId}:execute:no-bypass`,
        can: true,
        reason: "test",
        actingPlayerId: noBypassChoice.actingPlayerId,
        pendingId: noBypassChoice.pendingId,
        sourceInstanceId: noBypassChoice.sourceInstanceId,
        effectIndex: noBypassChoice.effectIndex,
        stepIndex: noBypassChoice.stepIndex,
        choice: "execute",
      },
      ...lookups,
    }).state;
    expect(noBypassResolved.pendingStepOptionalTargetSelection).toBeNull();
    expect(zoneOf(noBypassResolved, "enemy-2")).toBe("field");
    expect(zoneOf(noBypassResolved, "enemy-3")).toBe("hand");

    const bypassPending = executeEffect({
      chainId: "test:step-optional-target-selection:1714",
      state: protectedState,
      effect: optionalSecondTargetMagic.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "magic-1",
      actingPlayerId: "alice",
      targetInstanceIds: ["enemy-1"],
      targetStepId: "mandatory-deck",
      sourcePreventionBypass: {
        kind: "preventing_effect_filter",
        filter: { categories: ["nexus"] },
      },
      ...lookups,
    });
    const bypassChoice = bypassPending.pendingStepOptionalChoice!;
    const bypassResolved = applyLegalAction({
      state: bypassPending,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${bypassChoice.pendingId}:execute:bypass`,
        can: true,
        reason: "test",
        actingPlayerId: bypassChoice.actingPlayerId,
        pendingId: bypassChoice.pendingId,
        sourceInstanceId: bypassChoice.sourceInstanceId,
        effectIndex: bypassChoice.effectIndex,
        stepIndex: bypassChoice.stepIndex,
        choice: "execute",
      },
      ...lookups,
    }).state;
    const bypassSelection = bypassResolved.pendingStepOptionalTargetSelection!;
    expect(bypassSelection.candidateInstanceIds.sort()).toEqual(
      ["enemy-2", "enemy-3"].sort()
    );
    const bypassSelected = applyLegalAction({
      state: bypassResolved,
      action: {
        kind: "resolve_pending_step_optional_target_selection",
        actionId: `psots-${bypassSelection.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: bypassSelection.actingPlayerId,
        pendingId: bypassSelection.pendingId,
        sourceInstanceId: bypassSelection.sourceInstanceId,
        sourceDefinitionId: bypassSelection.sourceDefinitionId,
        effectIndex: bypassSelection.effectIndex,
        stepIndex: bypassSelection.stepIndex,
        requiredTargetCount: bypassSelection.requiredTargetCount,
        maxTargetCount: bypassSelection.maxTargetCount,
        candidateTargetInstanceIds: bypassSelection.candidateInstanceIds,
      },
      targetInstanceIds: ["enemy-2"],
      ...lookups,
    }).state;
    expect(bypassSelected.pendingStepOptionalTargetSelection).toBeNull();
    expect(zoneOf(bypassSelected, "enemy-2")).toBe("hand");
  });
});
