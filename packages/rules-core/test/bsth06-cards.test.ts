/**
 * BSTH06 (東方地霊殿) カードの effects 検証テスト。
 *
 * カード番号順に最小 1 ケース、効果実行後の盤面変化を検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  collectGameStateInvariantIssues,
  collectAndQueueTriggerReactions,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  generateBurstRegistrations,
  generateTriggeredEffectRegistrations,
  getAvailableBurstSourceChoices,
  getAvailableMagicPaymentSources,
  getEffectiveLevel,
  getLegalActions,
  playSummonAsAction,
  rebuildContinuousEffectsFromField,
} from "../src/runtime";
import {
  getCandidateTargetInstanceIds,
  recomputeContinuousEffects,
} from "../src/legal/legal-actions-shared";
import type { RegisteredTargetedEffectActionBase } from "../src/legal/legal-actions-types";
import type {
  CardDefinition,
  GameState,
  PendingBurstCheck,
  TriggerEventCause,
} from "../src/runtime";
import { finishCoreChoices } from "./helpers/core-choice-driver";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
};

function buildDeck(def: CardDefinition, ownerId: string, count: number) {
  return Array.from({ length: count }, (_, i) =>
    createCardInstance(def, {
      instanceId: `${ownerId}-deck-${i + 1}`,
      ownerPlayerId: ownerId,
      controllerPlayerId: ownerId,
      zone: "deck",
    })
  );
}

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId: string,
  options?: {
    choiceIndex?: number;
    getCardDefinitionById?: (id: string) => CardDefinition | undefined;
  }
) {
  const {
    choiceIndex,
    getCardDefinitionById: getDefinition = getCardDefinitionById,
  } = options ?? {};
  return executeEffect({
    chainId: "test:bsth06-cards:75",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById: getDefinition,
    ...(choiceIndex !== undefined ? { choiceIndex } : {}),
  });
}

function resolveMinimumSummonPlacement(
  state: GameState,
  getDefinition: (
    id: string
  ) => CardDefinition | undefined = getCardDefinitionById
): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions:
      effectLookups.getRegisteredTriggeredEffectActions,
  }).find((candidate) => candidate.kind === "resolve_pending_multi_placement");
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions:
      effectLookups.getRegisteredTriggeredEffectActions,
    multiPlacementAllocations: action!.targets.map((target) => ({
      destinationInstanceId: target.instanceId,
      placements: [{ kind: "reserve_normal", amount: target.minimumCoreCount }],
    })),
  }).state;
}

// ============================================================
// BSTH06-C01 [地底の釣瓶落とし]キスメ
// ============================================================
describe("BSTH06-C01 [地底の釣瓶落とし]キスメ", () => {
  const card = cardNoMap.get("BSTH06-C01")!;

  it("effects: 緑シンボル treat_as / 召喚時 deck_reveal / Lv2 BP1000破壊", () => {
    expect(card.effects?.length).toBe(3);
    const treat = card.effects![0]!.steps[0]!.action;
    expect(treat.kind).toBe("treat_as");
    if (treat.kind === "treat_as") expect(treat.asColor).toBe("green");
    expect(card.effects![1]!.steps[0]!.action.kind).toBe("deck_reveal");
    const destroy = card.effects![2]!.steps[0]!.action;
    expect(destroy.kind).toBe("destroy");
    if (
      destroy.kind === "destroy" &&
      typeof destroy.target === "object" &&
      "filter" in destroy.target
    ) {
      expect(destroy.target.filter.maxBp).toBe(1000);
    }
    expect(card.effects![2]!.condition).toEqual([
      { kind: "min_level", value: 2 },
    ]);
  });
});

// ============================================================
// BSTH06-C02 [地底の土蜘蛛]黒谷 ヤマメ
// ============================================================
describe("BSTH06-C02 [地底の土蜘蛛]黒谷 ヤマメ", () => {
  const card = cardNoMap.get("BSTH06-C02")!;

  it("effects: 赤シンボル treat_as / 召喚時 core+reveal / Lv2 BP2000重疲労", () => {
    const treat = card.effects![0]!.steps[0]!.action;
    if (treat.kind === "treat_as") expect(treat.asColor).toBe("red");
    expect(card.effects![1]!.steps[0]!.action.kind).toBe("core_move");
    expect(card.effects![1]!.steps[1]!.action.kind).toBe("deck_reveal");
    const exhaust = card.effects![2]!.steps[0]!.action;
    expect(exhaust.kind).toBe("exhaust");
    if (exhaust.kind === "exhaust")
      expect(exhaust.degree).toBe("heavy_exhaust");
  });

  it("Lv2 効果実行: BP2000以下の相手スピリットが重疲労する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "yamame-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    // 相手スピリット BP2000 (C02 自体 Lv1=3000 なので別カード使用: C01 Lv1=2000)
    const enemy = createCardInstance(cardNoMap.get("BSTH06-C01")!, {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, enemy],
    };
    const result = runEffect(state, card.effects![2]!, "yamame-1", "alice");
    const enemyAfter = result.cardInstances.find(
      (c) => c.instanceId === "enemy-1"
    )!;
    expect(enemyAfter.exhaustState).toBe("heavily_exhausted");
  });
});

// ============================================================
// BSTH06-C03 水橋 パルスィ
// ============================================================
describe("BSTH06-C03 水橋 パルスィ", () => {
  const card = cardNoMap.get("BSTH06-C03")!;

  const legalOptions = {
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      effectLookups.getRegisteredTriggeredEffectActions,
    getRegisteredFieldCardEffectActions:
      effectLookups.getRegisteredFieldCardEffectActions,
  };

  /**
   * 通常召喚で積まれた C03 の誘発を、実際の stack / step optional / step choice
   * 経路で発揮を受諾し、内部の任意手順へ進める。
   */
  function acceptC03Trigger(
    state: GameState,
    sourceInstanceId: string
  ): GameState {
    const resolve = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...legalOptions,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === sourceInstanceId
    );
    expect(resolve).toBeDefined();
    if (!resolve) throw new Error("missing BSTH06-C03 summon trigger");

    let current = applyLegalAction({
      state,
      action: resolve,
      ...legalOptions,
    }).state;
    for (let guard = 0; current.stackWindow && guard < 4; guard += 1) {
      const pass = getLegalActions({
        state: current,
        actingPlayerId: current.stackWindow.priorityPlayerId,
        ...legalOptions,
      }).find((action) => action.kind === "pass_stack");
      expect(pass).toBeDefined();
      if (!pass) throw new Error("missing C03 stack pass");
      current = applyLegalAction({
        state: current,
        action: pass,
        ...legalOptions,
      }).state;
    }
    expect(current.stackWindow).toBeNull();
    return current;
  }

  function resolveAcceptedC03TriggerWithCorePlacement(
    state: GameState,
    sourceInstanceId: string
  ): GameState {
    let current = acceptC03Trigger(state, sourceInstanceId);
    const executeCoreDistribute = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      ...legalOptions,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "execute"
    );
    expect(executeCoreDistribute).toBeDefined();
    if (!executeCoreDistribute) {
      throw new Error("missing C03 optional core-distribute execution");
    }
    current = applyLegalAction({
      state: current,
      action: executeCoreDistribute,
      ...legalOptions,
    }).state;
    const targets = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      ...legalOptions,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    if (targets) {
      current = applyLegalAction({
        state: current,
        action: targets,
        targetInstanceIds: [sourceInstanceId, "parusii-support"],
        ...legalOptions,
      }).state;
    }
    expect(
      current.cardInstances.find(
        (entry) => entry.instanceId === sourceInstanceId
      )?.normalCoreCount
    ).toBe(2);
    expect(
      current.cardInstances.find(
        (entry) => entry.instanceId === "parusii-support"
      )?.normalCoreCount
    ).toBe(2);
    expect(current.players[0]!.voidNormalCoreCount).toBe(8);

    const declineSummon = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      ...legalOptions,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_choice" &&
        action.choiceIndex === 0
    );
    expect(declineSummon).toBeDefined();
    if (!declineSummon) throw new Error("missing C03 summon choice decline");
    return applyLegalAction({
      state: current,
      action: declineSummon,
      ...legalOptions,
    }).state;
  }

  it("effects[0] 召喚時 core_distribute (遊精/皇獣2体) + コスト階層召喚choice (stub 解消)", () => {
    const e = card.effects![0]!;
    expect(e.usageLimit).toEqual({ kind: "per_card_name", duration: "turn" });
    const action = e.steps[0]!.action;
    expect(action.kind).toBe("core_distribute");
    expect(e.stub).toBeUndefined();
    const choiceStep = e.steps[1]!;
    expect(choiceStep.action.kind).toBe("noop");
    expect(choiceStep.choice).toHaveLength(2);
    const tier1 = choiceStep.choice![0]!.action;
    const tier2 = choiceStep.choice![1]!.action;
    expect(tier1.kind).toBe("summon");
    expect(tier2.kind).toBe("summon");
    if (tier1.kind === "summon" && tier1.target.kind === "from_zone") {
      expect(tier1.target.zone).toEqual(["hand", "set_aside", "trash"]);
      expect(tier1.target.filter).toMatchObject({
        category: ["spirit", "ultimate", "brave"],
        tribes: ["遊精", "皇獣"],
        maxCost: 4,
      });
      expect(tier1.costModifier).toEqual({ fixedPayment: 1 });
    }
    if (tier2.kind === "summon" && tier2.target.kind === "from_zone") {
      expect(tier2.target.filter).toMatchObject({ maxCost: 6 });
      expect(tier2.costModifier).toEqual({ fixedPayment: 2 });
    }
  });

  it("effects[0] core_distribute+choice registration: choices[] に3変種(辞退/コスト4以下/コスト6以下)、各 targetGroups で core_distribute(2体)+summon(1枚)のtarget要求が分離される (ENGINE-core-distribute-field-targeting-registration 既存固定 count 回帰確認 + choice 併存)", () => {
    // 配線前は registration が空 = executeCoreDistribute 内の resolveTargetSpec が
    // auto-pick で先頭 2 体を選んでいた。配線後は pendingEffectTargetSelection が立ち
    // プレイヤーに 2 体選択を強制する。本カードに召喚choiceを追加したことで registration は
    // P3-24 の choices[] 集約経路 (buildChoiceVariantsWithSharedTargeting) に切り替わり、
    // steps[0] (core_distribute) の共有targetingが各choice変種にマージされる
    // (targetGroups で内訳を保持、mergeSharedAndChoiceTargeting)。
    const regs = generateTriggeredEffectRegistrations(card);
    const summonReg = regs.find(
      (r) => r.effectCategory === "triggered" && r.effectIndex === 0
    );
    expect(summonReg).toBeDefined();
    expect(summonReg!.choices).toBeUndefined();
    expect(summonReg!.requiredTargetCount ?? 0).toBe(0);
    // コア配置後、更新された盤面で初めて召喚方法・対象を選ぶ。
    const choiceReg = generateTriggeredEffectRegistrations({
      ...card,
      effects: [
        { ...card.effects![0]!, steps: card.effects![0]!.steps.slice(1) },
      ],
    })[0]!;
    expect(choiceReg.choices).toHaveLength(3);
    const [decline, tier1, tier2] = choiceReg.choices!;
    // 任意のコア配置は実行選択後に対象を選ぶ。辞退する召喚には事前対象がない。
    expect(decline!.requiredTargetCount).toBeUndefined();
    expect(decline!.maxTargetCount).toBeUndefined();
    // 召喚を選ぶ分岐は召喚先1枚だけを事前選択する。
    for (const [variant, maxCost] of [
      [tier1, 4],
      [tier2, 6],
    ] as const) {
      expect(variant!.requiredTargetCount).toBe(1);
      expect(variant!.candidateTargetZones).toEqual([
        "hand",
        "set_aside",
        "trash",
      ]);
      expect(variant!.targetCardFilter).toMatchObject({ maxCost });
    }
  });

  it("[board] 〔ターンに1回:同名〕: 通常召喚後に同一プレイヤーの別個体は発揮できず、相手の同名は独立する", () => {
    const first = createCardInstance(card, {
      instanceId: "parusii-first",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const second = createCardInstance(card, {
      instanceId: "parusii-second",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const opponent = createCardInstance(card, {
      instanceId: "parusii-opponent",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const initial = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          first,
          second,
          opponent,
          createCardInstance(card, {
            instanceId: "parusii-support",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
        playerOverrides: [
          { reserveNormalCoreCount: 12, voidNormalCoreCount: 10 },
          { reserveNormalCoreCount: 6, voidNormalCoreCount: 10 },
        ],
      }),
      activePlayerId: "alice" as const,
      step: "main" as const,
    };

    const firstSummoned = playSummonAsAction({
      state: initial,
      actingPlayerId: "alice",
      cardInstanceId: first.instanceId,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        effectLookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    }).state;
    const firstResolved = resolveAcceptedC03TriggerWithCorePlacement(
      firstSummoned,
      first.instanceId
    );
    expect(firstResolved.effectUsageRecords).toContainEqual(
      expect.objectContaining({
        sourceDefinitionId: card.cardNo,
        effectLabel: "effect:0",
        playerId: "alice",
        duration: "turn",
      })
    );
    expect(firstResolved.pendingTriggeredEffects).toHaveLength(0);

    const secondSummoned = playSummonAsAction({
      state: firstResolved,
      actingPlayerId: "alice",
      cardInstanceId: second.instanceId,
      // 緑軽減は1枠なので、場の同名2体でも通常コストは4→3。
      paymentSources: [{ kind: "reserve", amount: 3 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        effectLookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    }).state;
    expect(
      secondSummoned.pendingTriggeredEffects.some(
        (pending) => pending.sourceInstanceId === second.instanceId
      )
    ).toBe(false);

    const opponentSummoned = playSummonAsAction({
      state: { ...secondSummoned, activePlayerId: "bob" },
      actingPlayerId: "bob",
      cardInstanceId: opponent.instanceId,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        effectLookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    }).state;
    // pending は event 自体を表し、発揮元の確定は legal actions で行う。Alice の
    // usage record は playerId ごとに照合されるため、BOB の同名は実際に解決候補になる。
    expect(
      getLegalActions({
        state: opponentSummoned,
        actingPlayerId: "bob",
        ...legalOptions,
      }).some(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceInstanceId === opponent.instanceId &&
          action.sourceCardNo === card.cardNo
      )
    ).toBe(true);
  });

  it("[board] 配布辞退後は空の召喚辞退を提示も受理もせず、1コスト召喚を完走する", () => {
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(card, {
            instanceId: "source",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(card, {
            instanceId: "followup",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
        playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
    };
    state = executeEffect({
      chainId: "c03-decline-contract",
      state,
      effect: card.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      promptUnresolvedChoice: true,
      ...legalOptions,
    });
    const decline = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...legalOptions,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "decline"
    );
    expect(decline).toBeDefined();
    state = applyLegalAction({
      state,
      action: decline!,
      ...legalOptions,
    }).state;
    // 保存復元後も、辞退済みの前段を実行済みpayloadと誤認しない。
    state = JSON.parse(JSON.stringify(state)) as GameState;
    const choices = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...legalOptions,
    }).filter((a) => a.kind === "resolve_pending_step_choice");
    expect(choices.map((a) => a.choiceIndex)).toEqual([1, 2]);
    const tier1 = choices.find((a) => a.choiceIndex === 1)!;
    expect(() =>
      applyLegalAction({
        state,
        action: { ...tier1, choiceIndex: 0 },
        ...legalOptions,
      })
    ).toThrow(/not available/);
    state = applyLegalAction({ state, action: tier1, ...legalOptions }).state;
    const target = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...legalOptions,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    if (target)
      state = applyLegalAction({
        state,
        action: target,
        targetInstanceIds: ["followup"],
        ...legalOptions,
      }).state;
    const zone = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...legalOptions,
    }).find((a) => a.kind === "resolve_pending_zone_selection");
    if (zone)
      state = applyLegalAction({
        state,
        action: zone,
        selectedZoneCardIds: ["followup"],
        ...legalOptions,
      }).state;
    state = finishCoreChoices(state, getCardDefinitionById, legalOptions);
    expect(
      state.cardInstances.find((entry) => entry.instanceId === "followup")?.zone
    ).toBe("field");
    expect(state.players[0]!.reserveNormalCoreCount).toBe(3);
    expect(state.players[0]!.trashNormalCoreCount).toBe(1);
    expect(state.pendingStepChoice).toBeNull();
    expect(state.pendingMultiPlacement).toBeNull();
  });

  it.each(["no-target", "no-payment"])(
    "[board] 配布辞退後に召喚不能(%s)なら入力不能なchoiceを残さず不発にする",
    (reason) => {
      let state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            createCardInstance(card, {
              instanceId: "source",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 1,
            }),
            ...(reason === "no-payment"
              ? [
                  createCardInstance(card, {
                    instanceId: "followup",
                    ownerPlayerId: "alice",
                    zone: "hand",
                  }),
                ]
              : []),
          ],
          playerOverrides: [
            { reserveNormalCoreCount: reason === "no-payment" ? 0 : 5 },
            {},
          ],
        }),
        activePlayerId: "alice",
        step: "main",
      };
      state = executeEffect({
        chainId: `c03-unavailable-${reason}`,
        state,
        effect: card.effects![0]!,
        effectIndex: 0,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        promptUnresolvedChoice: true,
        ...legalOptions,
      });
      const decline = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...legalOptions,
      }).find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "decline"
      );
      expect(decline).toBeDefined();
      state = applyLegalAction({
        state,
        action: decline!,
        ...legalOptions,
      }).state;
      expect(state.pendingStepChoice).toBeNull();
      expect(state.pendingStepOptionalChoice).toBeNull();
      expect(state.pendingMultiPlacement).toBeNull();
      expect(
        state.cardInstances.filter((entry) => entry.zone === "field")
      ).toHaveLength(1);
      expect(state.players[0]!.reserveNormalCoreCount).toBe(
        reason === "no-payment" ? 0 : 5
      );
      expect(state.players[0]!.trashNormalCoreCount).toBe(0);
    }
  );

  it("[board] 本文のコスト4/6以下は実効/追加コストを候補にし、印字コスト限定にはしない", () => {
    const makeEligibleDefinition = (cardNo: string, cost: number) => ({
      ...cardNoMap.get("BSTH06-C01")!,
      cardNo,
      name: cardNo,
      cost,
      effects: [],
    });
    const runTier = (args: {
      label: string;
      choiceIndex: 1 | 2;
      maxCost: 4 | 6;
      printedCost: number;
      additionalCost: number;
      expectedReserve: number;
    }) => {
      const targetDefinition = makeEligibleDefinition(
        `BSTH06-C03-${args.label}`,
        args.printedCost
      );
      const getDefinition = (id: string) =>
        id === targetDefinition.cardNo
          ? targetDefinition
          : getCardDefinitionById(id);
      const source = createCardInstance(card, {
        instanceId: `parusii-effective-${args.label}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
      });
      const target = createCardInstance(targetDefinition, {
        instanceId: `effective-${args.label}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "hand",
      });
      const base = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [source, target],
          playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
        }),
        activePlayerId: "alice" as const,
        step: "main" as const,
        activeContinuousEffects: [
          {
            effectId: `additional-cost-${args.label}`,
            sourceInstanceId: source.instanceId,
            sourceDefinitionId: card.cardNo,
            actingPlayerId: "alice",
            duration: { scope: "permanent" as const },
            createdAtTurn: 1,
            createdAtAttackId: null,
            modifierTag: "additional_cost" as const,
            targetInstanceId: target.instanceId,
            modifierAmount: args.additionalCost,
            metadata: {},
          },
        ],
      };
      const isolatedChoiceEffect = {
        ...card.effects![0]!,
        steps: [card.effects![0]!.steps[1]!],
      };
      const after = resolveMinimumSummonPlacement(
        runEffect(base, isolatedChoiceEffect, source.instanceId, "alice", {
          choiceIndex: args.choiceIndex,
          getCardDefinitionById: getDefinition,
        }),
        getDefinition
      );
      expect(
        after.cardInstances.find(
          (entry) => entry.instanceId === target.instanceId
        )?.zone
      ).toBe("field");
      expect(
        after.players.find((player) => player.id === "alice")
          ?.reserveNormalCoreCount
      ).toBe(args.expectedReserve);

      const choiceRegistration = generateTriggeredEffectRegistrations({
        ...card,
        effects: [
          { ...card.effects![0]!, steps: card.effects![0]!.steps.slice(1) },
        ],
      })[0]!.choices![args.choiceIndex]!;
      expect(
        getCandidateTargetInstanceIds(base, "alice", choiceRegistration, {
          sourceInstanceId: source.instanceId,
          getCardDefinitionById: getDefinition,
        })
      ).toEqual([target.instanceId]);
      expect(
        getCandidateTargetInstanceIds(
          base,
          "alice",
          {
            ...choiceRegistration,
            targetCardFilter: {
              ...choiceRegistration.targetCardFilter!,
              costBasis: "printed",
            },
          },
          {
            sourceInstanceId: source.instanceId,
            getCardDefinitionById: getDefinition,
          }
        )
      ).toEqual([]);
    };

    // 印字5だが「コスト4としても扱う」候補は、1コスト分岐で召喚できる。
    runTier({
      label: "tier1",
      choiceIndex: 1,
      maxCost: 4,
      printedCost: 5,
      additionalCost: 4,
      expectedReserve: 3,
    });
    // 印字7だが「コスト6としても扱う」候補も、2コスト分岐で召喚できる。
    runTier({
      label: "tier2",
      choiceIndex: 2,
      maxCost: 6,
      printedCost: 7,
      additionalCost: 6,
      expectedReserve: 2,
    });
  });

  it("[board] choiceIndex=1: 手札のコスト3(遊精/皇獣)カードを1コストで召喚できる", () => {
    const isolatedChoiceEffect = {
      ...card.effects![0]!,
      steps: [card.effects![0]!.steps[1]!],
    };
    const source = createCardInstance(card, {
      instanceId: "parusii-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const handCard = createCardInstance(cardNoMap.get("BSTH06-C01")!, {
      instanceId: "hand-c01",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, handCard],
      playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
    });
    const after = resolveMinimumSummonPlacement(
      runEffect(
        { ...base, activePlayerId: "alice", step: "main" },
        isolatedChoiceEffect,
        "parusii-1",
        "alice",
        { choiceIndex: 1 }
      )
    );
    const summoned = after.cardInstances.find(
      (c) => c.instanceId === "hand-c01"
    )!;
    expect(summoned.zone).toBe("field");
    // BSTH06-C01 levelDefs[0].requiredCores === 1
    expect(summoned.normalCoreCount).toBe(1);
    const alice = after.players.find((p) => p.id === "alice")!;
    // 「1コスト支払って」は固定支払いで、場の緑シンボルでも軽減されない。
    // fixedPayment:1 と requiredCores:1 (維持コア配置) を払い reserve 5→3。
    expect(alice.reserveNormalCoreCount).toBe(3);
  });

  it("[board] choiceIndex=2: 手札のコスト6(遊精/皇獣)カードを2コストで召喚できる", () => {
    const isolatedChoiceEffect = {
      ...card.effects![0]!,
      steps: [card.effects![0]!.steps[1]!],
    };
    const source = createCardInstance(card, {
      instanceId: "parusii-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const handCard = createCardInstance(cardNoMap.get("BSTH06-M01")!, {
      instanceId: "hand-m01",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, handCard],
      playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
    });
    const after = resolveMinimumSummonPlacement(
      runEffect(
        { ...base, activePlayerId: "alice", step: "main" },
        isolatedChoiceEffect,
        "parusii-2",
        "alice",
        { choiceIndex: 2 }
      )
    );
    const summoned = after.cardInstances.find(
      (c) => c.instanceId === "hand-m01"
    )!;
    expect(summoned.zone).toBe("field");
    // BSTH06-M01 levelDefs[0].requiredCores === 1
    expect(summoned.normalCoreCount).toBe(1);
    const alice = after.players.find((p) => p.id === "alice")!;
    // 「2コスト支払って」も固定支払いで、緑シンボルでも軽減されない。
    // fixedPayment:2 と requiredCores:1 (維持コア配置) を払い reserve 5→2。
    expect(alice.reserveNormalCoreCount).toBe(2);
  });

  it("[board] choiceIndex=0 (デフォルト/辞退): 召喚は発生しない", () => {
    const isolatedChoiceEffect = {
      ...card.effects![0]!,
      steps: [card.effects![0]!.steps[1]!],
    };
    const source = createCardInstance(card, {
      instanceId: "parusii-3",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const handCard = createCardInstance(cardNoMap.get("BSTH06-C01")!, {
      instanceId: "hand-c01-skip",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, handCard],
      playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
    });
    const after = runEffect(
      { ...base, activePlayerId: "alice", step: "main" },
      isolatedChoiceEffect,
      "parusii-3",
      "alice"
    );
    const notSummoned = after.cardInstances.find(
      (c) => c.instanceId === "hand-c01-skip"
    )!;
    expect(notSummoned.zone).toBe("hand");
    const alice = after.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(5);
  });

  it("effects[1] 地霊スピリット最高Lv扱いは override_properties(level:max) で表現（stub 解消）", () => {
    expect(card.effects![1]!.stub).toBeUndefined();
  });

  it("[board] 自分のアタックステップ・パルスィLv2以上のとき、地霊スピリットは最高Lv扱いになる", () => {
    const parusii = createCardInstance(card, {
      instanceId: "parusii",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3, // levelDefs lv2.requiredCores === 3
    });
    const jireiDef: CardDefinition = {
      cardNo: "TEST-JIREI",
      name: "test jirei spirit",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 1000 },
        { level: 2, requiredCores: 5, bp: 2000 },
      ],
      symbolColors: ["green"],
      textLines: [],
      keywordTags: [],
      tribe: "地霊",
      effects: [],
    };
    const targetCard = createCardInstance(jireiDef, {
      instanceId: "jirei-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1, // 単独では Lv1
    });
    const getDef = (id: string) =>
      id === "TEST-JIREI" ? jireiDef : getCardDefinitionById(id);

    const attackState = {
      ...createEmptyGameState({ cardInstances: [parusii, targetCard] }),
      step: "attack" as const,
      activePlayerId: "alice",
    };
    const afterAttack = rebuildContinuousEffectsFromField(attackState, getDef);
    expect(getEffectiveLevel(afterAttack, targetCard, jireiDef, getDef)).toBe(
      2
    );

    // timingScope: { player: "self", period: "attack" } — メインステップでは適用されない
    const mainState = { ...attackState, step: "main" as const };
    const afterMain = rebuildContinuousEffectsFromField(mainState, getDef);
    expect(getEffectiveLevel(afterMain, targetCard, jireiDef, getDef)).toBe(1);
  });
});

// ============================================================
// BSTH06-C04 火焔猫 燐
// ============================================================
describe("BSTH06-C04 火焔猫 燐", () => {
  const card = cardNoMap.get("BSTH06-C04")!;

  it("effects[0] 召喚時 ネクサス/創界神破壊 (targetsGrandwalker)", () => {
    const destroy = card.effects![0]!.steps[0]!.action;
    expect(destroy.kind).toBe("destroy");
    if (
      destroy.kind === "destroy" &&
      typeof destroy.target === "object" &&
      "filter" in destroy.target
    ) {
      expect(destroy.target.filter.category).toEqual(["nexus"]);
      expect(destroy.target.filter.targetsGrandwalker).toBe(true);
    }
  });

  it("effects[1] フラッシュ: exhaust(自身)コスト + draw/place 選択", () => {
    const e = card.effects![1]!;
    expect(e.steps[0]!.action.kind).toBe("exhaust");
    expect(e.steps[1]!.connector).toBe("conditional_cost");
    expect(e.steps[1]!.action.kind).toBe("draw"); // choiceIndex 0
    expect(e.steps[1]!.choice?.[0]?.action.kind).toBe("search_zone"); // choiceIndex 1
  });
});

// ============================================================
// BSTH06-M01 [地霊殿]東風谷 早苗 (バースト)
// ============================================================
describe("BSTH06-M01 [地霊殿]東風谷 早苗", () => {
  const card = cardNoMap.get("BSTH06-M01")!;

  it("keywordTags burst / effects[0] バースト重疲労2体+召喚", () => {
    expect(card.keywordTags).toContain("burst");
    expect(card.effects![0]!.timing.kind).toBe("burst");
    const exhaust = card.effects![0]!.steps[0]!.action;
    if (exhaust.kind === "exhaust") {
      expect(exhaust.degree).toBe("heavy_exhaust");
    }
    expect(card.effects![0]!.steps[1]!.action.kind).toBe("summon");
  });

  it("バースト発動条件「相手によって自分のスピリットが離れた後」: cause=[opponent_effect,battle] (stub 解消)", () => {
    // 旧 stub: spirit_destroyed で近似 → 実際は leave_field にマップされ破壊以外の離脱も拾う。
    // 自分起因の離脱を除外するため cause を明示。card-data 側でのみ表現。
    expect(card.effects![0]!.stub).toBeUndefined();
    const timing = card.effects![0]!.timing;
    if (timing.kind === "burst") {
      expect(timing.cause).toEqual(["opponent_effect", "battle"]);
    }
  });

  it("バースト発動: 相手効果/バトル由来の離脱で発動候補・自分効果由来/非スピリット離脱では除外", () => {
    const regs = generateBurstRegistrations(card);
    const leaveReg = regs.find((r) => r.eventKind === "leave_field")!;
    expect(leaveReg).toBeDefined();
    expect(leaveReg.whose).toBe("self");
    expect(leaveReg.cause).toEqual(["opponent_effect", "battle"]);
    // triggerFilter category:["spirit"] — 「自分のスピリット」限定 (BSTH03-M01 と同型)。
    expect(leaveReg.triggerFilter).toEqual({ category: ["spirit"] });

    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const burstSource = createCardInstance(card, {
      instanceId: "sanae-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    // 離脱した自分のスピリット（trash 上のカードが triggerFilter 対象）。
    const departedSpiritDef = ALL_CARDS.find(
      (c) => c.printedCategory === "spirit" && c.cardNo !== card.cardNo
    )!;
    const departedSpirit = createCardInstance(departedSpiritDef, {
      instanceId: "my-spirit",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    // 離脱した自分のネクサス（スピリットでないため triggerFilter で除外されるべき）。
    const departedNexusDef = ALL_CARDS.find(
      (c) => c.printedCategory === "nexus"
    )!;
    const departedNexus = createCardInstance(departedNexusDef, {
      instanceId: "my-nexus",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const state: GameState = {
      ...base,
      cardInstances: [burstSource, departedSpirit, departedNexus],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "sanae-burst" }],
    };
    const check = (
      cause: TriggerEventCause,
      relatedInstanceId: string
    ): PendingBurstCheck => ({
      checkId: "c1",
      actingPlayerId: "alice",
      source: "action_resolution",
      chainId: "test:bsth06-cards:858",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId,
      amount: 1,
      step: "attack",
      window: "battle_resolution",
      resolvedBurstCardInstanceIds: [],
      eventKind: "leave_field",
      event: { family: "leave_field", validationMode: "snapshot_only", cause },
    });
    const choicesFor = (cause: TriggerEventCause, relatedInstanceId: string) =>
      getAvailableBurstSourceChoices({
        state,
        pendingBurstCheck: check(cause, relatedInstanceId),
        getCardDefinitionById,
        getRegisteredBurstActions: (cardNo) =>
          cardNo === card.cardNo ? [leaveReg] : undefined,
      });
    // 相手効果由来・バトル討ち取りで自分のスピリットが離れた → 発動候補に含まれる。
    expect(choicesFor("opponent_effect", "my-spirit")).toHaveLength(1);
    expect(choicesFor("battle", "my-spirit")).toHaveLength(1);
    // 自分効果由来 → cause で除外（旧近似では誤発火していた）。
    expect(choicesFor("self_effect", "my-spirit")).toHaveLength(0);
    // 離れたのがネクサス（スピリットでない）→ triggerFilter で除外（過剰発火防止）。
    expect(choicesFor("opponent_effect", "my-nexus")).toHaveLength(0);
  });

  it("バースト効果実行: 相手スピリット2体が重疲労する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "sanae-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const enemies = ["e1", "e2"].map((id) =>
      createCardInstance(cardNoMap.get("BSTH06-C01")!, {
        instanceId: id,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "recovered",
      })
    );
    const state: GameState = {
      ...base,
      activePlayerId: "bob",
      step: "attack",
      cardInstances: [self, ...enemies],
    };
    const result = runEffect(state, card.effects![0]!, "sanae-1", "alice");
    const exhausted = result.cardInstances.filter(
      (c) => c.ownerPlayerId === "bob" && c.exhaustState === "heavily_exhausted"
    );
    expect(exhausted.length).toBe(2);
  });

  it("effects[1]『自分のアタックステップ』相手のマジックのスタック効果使用コスト+1 (stub 解消)", () => {
    expect(card.effects![1]!.stub).toBeUndefined();
    const action = card.effects![1]!.steps[0]!.action;
    expect(action.kind).toBe("cost_modify");
    if (action.kind === "cost_modify") {
      expect(action.cardFilter).toEqual({
        category: ["magic"],
        usingEffectMode: ["stack"],
      });
    }
  });

  it("set 中では Lv 常時効果を登録せず、召喚後の field でのみ相手マジックのスタックコストを+1する", () => {
    const burstSource = createCardInstance(card, {
      instanceId: "sanae-set-continuous",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const opponentMagic = createCardInstance(cardNoMap.get("BSTH06-R01")!, {
      instanceId: "bob-set-magic",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const setState: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [burstSource, opponentMagic],
      setBurstStates: [
        { playerId: "alice", cardInstanceId: burstSource.instanceId },
      ],
    };

    const setRegistered = rebuildContinuousEffectsFromField(
      setState,
      getCardDefinitionById
    );
    const setCe = setRegistered.activeContinuousEffects.filter(
      (ce) => ce.sourceInstanceId === burstSource.instanceId
    );
    expect(setCe).toHaveLength(0);

    const setRecomputed = recomputeContinuousEffects(setRegistered);
    expect(
      setRecomputed.activeContinuousEffects.filter(
        (ce) => ce.sourceInstanceId === burstSource.instanceId
      )
    ).toHaveLength(0);
    expect(
      collectGameStateInvariantIssues(setRecomputed, {
        getCardDefinitionById,
      }).filter((issue) => issue.code === "missing_continuous_effect")
    ).toHaveLength(0);
    expect(
      getAvailableMagicPaymentSources({
        state: setRecomputed,
        actingPlayerId: "bob",
        magicInstanceId: opponentMagic.instanceId,
        getCardDefinitionById,
        effectMode: "stack",
      }).reduction.finalCost
    ).toBe(4);

    const fieldSource = {
      ...burstSource,
      zone: "field" as const,
      normalCoreCount: 1,
    };
    const fieldRegistered = rebuildContinuousEffectsFromField(
      {
        ...setState,
        cardInstances: [fieldSource, opponentMagic],
        setBurstStates: [],
      },
      getCardDefinitionById
    );
    const fieldCe = fieldRegistered.activeContinuousEffects.filter(
      (ce) => ce.sourceInstanceId === fieldSource.instanceId
    );
    expect(fieldCe).toHaveLength(1);
    expect(fieldCe[0]!.duration).toEqual({ scope: "while_on_field" });
    expect(
      recomputeContinuousEffects(
        fieldRegistered
      ).activeContinuousEffects.filter(
        (ce) => ce.sourceInstanceId === fieldSource.instanceId
      )
    ).toHaveLength(1);
    expect(
      getAvailableMagicPaymentSources({
        state: fieldRegistered,
        actingPlayerId: "bob",
        magicInstanceId: opponentMagic.instanceId,
        getCardDefinitionById,
        effectMode: "stack",
      }).reduction.finalCost
    ).toBe(5);
  });

  it("盤面: 自分のアタックステップ中、相手のマジックのスタック使用コストが+1される (main モードは影響なし)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "sanae-continuous",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = cardNoMap.get("BSTH06-R01")!; // cost 4 のマジック
    const opponentMagic = createCardInstance(magic, {
      instanceId: "bob-magic-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const registered = runEffect(
      {
        ...base,
        activePlayerId: "alice",
        step: "attack",
        cardInstances: [self, opponentMagic],
      },
      card.effects![1]!,
      "sanae-continuous",
      "alice"
    );

    const stackResult = getAvailableMagicPaymentSources({
      state: registered,
      actingPlayerId: "bob",
      magicInstanceId: "bob-magic-1",
      getCardDefinitionById,
      effectMode: "stack",
    });
    expect(stackResult.reduction.finalCost).toBe(5); // 4 + 1

    const mainResult = getAvailableMagicPaymentSources({
      state: registered,
      actingPlayerId: "bob",
      magicInstanceId: "bob-magic-1",
      getCardDefinitionById,
      effectMode: "main",
    });
    expect(mainResult.reduction.finalCost).toBe(4); // 不一致・影響なし
  });
});

// ============================================================
// BSTH06-R01 「サブタレイニアンローズ」 (マジック)
// ============================================================
describe("BSTH06-R01 「サブタレイニアンローズ」", () => {
  const card = cardNoMap.get("BSTH06-R01")!;

  it("系統付与 / フラッシュ重疲労2体 / スタック疲労(2スピリット|1アルティメット選択)", () => {
    const t = card.effects![0]!.steps[0]!.action;
    if (t.kind === "override_properties") {
      expect(t.properties.addTribes).toEqual(["幻想", "地霊"]);
    }
    expect(card.effects![1]!.timing).toEqual({
      kind: "activated",
      mode: "flash",
    });
    const stack = card.effects![2]!;
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(stack.steps[0]!.action.kind).toBe("exhaust"); // 2 spirits
    expect(stack.steps[0]!.choice?.[0]?.action.kind).toBe("exhaust"); // 1 ultimate
  });
});

// ============================================================
// BSTH06-R02 「サブタレイニアンサン」 (マジック)
// ============================================================
describe("BSTH06-R02 「サブタレイニアンサン」", () => {
  const card = cardNoMap.get("BSTH06-R02")!;

  it("系統付与 / メイン2ドロー / フラッシュ創界石コア配置 (stub 解消)", () => {
    expect(card.effects?.length).toBe(3);
    expect(card.effects![1]!.steps[0]!.action.kind).toBe("draw");
    const flash = card.effects![2]!;
    expect(flash.stub).toBeUndefined();
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    // 『お互いのアタックステップ』= timingScope player:"both"/period:"attack"。
    expect(flash.timingScope).toEqual({ player: "both", period: "attack" });
    // 「ターンに1回」= per_card_name:turn (マジックは per_instance では別コピーを
    // ブロックできないため、同名共有枠の per_card_name が SSOT。BSFT01 鍵マジック群同型)。
    expect(flash.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    // ボイド→地霊の自分の創界石ネクサス（targetsGrandstone:true 必須）。
    const action = flash.steps[0]!.action;
    expect(action.kind).toBe("core_move");
    if (action.kind === "core_move") {
      expect(action.from).toEqual({ kind: "void", player: "self" });
      expect(action.amount).toBe(1);
      expect(action.to).toBeDefined();
      if (action.to && action.to.kind === "field_card") {
        expect(action.to.player).toBe("self");
        expect(action.to.filter).toMatchObject({
          category: ["nexus"],
          tribes: ["地霊", "創界石"],
          tribesLogic: "and",
          targetsGrandstone: true,
        });
      } else {
        throw new Error("expected to.kind === 'field_card'");
      }
    }
  });

  it("メイン効果実行: 2ドローで手札+2", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: buildDeck(card, "alice", 5),
    };
    const result = runEffect(state, card.effects![1]!, "x", "alice");
    const hand = result.cardInstances.filter(
      (c) => c.ownerPlayerId === "alice" && c.zone === "hand"
    );
    expect(hand.length).toBe(2);
  });
});

// ============================================================
// BSTH06-X01 [導界者]古明地 さとり (ネクサス)
// ============================================================
describe("BSTH06-X01 [導界者]古明地 さとり", () => {
  const card = cardNoMap.get("BSTH06-X01")!;

  it("treat_as 赤/緑 / 配置時 相手手札→手元 / コスト下限のみ stub", () => {
    const treat = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    const colors = treat.steps.map((s) =>
      s.action.kind === "treat_as" ? s.action.asColor : null
    );
    expect(colors).toEqual(["red", "green"]);
    const place = card.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        e.steps[0]?.action.kind === "move_card"
    )!;
    expect(place).toBeDefined();
    // 本体ルール+導託は grandwalkerData へ移行、導域は game_event DSL 化、
    // 配置コスト下限 (0にならない=floor:1) は cost_modify(floor) で表現 → 残 stub なし
    expect(card.effects!.filter((e) => e.stub).length).toBe(0);
  });

  it("grandwalkerData: guided + 導託〔地霊＆コスト3以上〕+ 標準 placementOracle + コア配置禁止タグ", () => {
    const gw = card.grandwalkerData!;
    expect(gw.kind).toBe("guided");
    expect(gw.oracleConditions).toEqual([
      { tribes: ["地霊"], minCost: 3, categories: ["spirit"] },
    ]);
    expect(gw.placementOracle).toBeUndefined();
    expect(card.keywordTags).toContain("enter_field_core_placement_forbidden");
  });

  it("【導域】Lv2: 地霊スピリット召喚を game_event で観測し、配置時効果とターン1回制限を共有する", () => {
    const dom = card.effects!.find((e) => e.timing.kind === "game_event")!;
    expect(dom.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "summon",
      triggerFilter: { category: ["spirit"], tribes: ["地霊"] },
    });
    expect(dom.timingScope).toEqual({ player: "self", period: "main" });
    expect(dom.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "field_has", player: "self", zone: "trash", tribes: ["地霊"] },
    ]);
    expect(dom.limitGroupId).toBe("BSTH06-X01-place-effect");
    const place = card.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        e.steps[0]?.action.kind === "move_card"
    )!;
    expect(place.limitGroupId).toBe("BSTH06-X01-place-effect");
    expect(dom.steps[0]!.action).toEqual(place.steps[0]!.action);
  });

  it("導域効果実行: Lv2+トラッシュ地霊で相手の手札すべてが手元へ移る", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "satori-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3, // Lv2 (requiredCores: 3)
    });
    const trashGeirei = createCardInstance(card, {
      instanceId: "trash-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const enemyHand = ["h1", "h2"].map((id) =>
      createCardInstance(cardNoMap.get("BSTH06-C01")!, {
        instanceId: id,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "hand",
      })
    );
    const dom = card.effects!.find((e) => e.timing.kind === "game_event")!;
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, trashGeirei, ...enemyHand],
    };
    const result = executeEffect({
      chainId: "test:bsth06-cards:1237",
      state,
      effect: dom,
      sourceInstanceId: "satori-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      result.cardInstances.filter(
        (c) => c.ownerPlayerId === "bob" && c.zone === "hand"
      ).length
    ).toBe(0);
    expect(
      result.cardInstances.filter(
        (c) => c.ownerPlayerId === "bob" && c.zone === "set_aside"
      ).length
    ).toBe(2);
  });

  it("導域効果: Lv1（コア不足）では発揮されない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "satori-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0, // Lv1
    });
    const trashGeirei = createCardInstance(card, {
      instanceId: "trash-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const enemyHand = createCardInstance(cardNoMap.get("BSTH06-C01")!, {
      instanceId: "h1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const dom = card.effects!.find((e) => e.timing.kind === "game_event")!;
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, trashGeirei, enemyHand],
    };
    const result = executeEffect({
      chainId: "test:bsth06-cards:1284",
      state,
      effect: dom,
      sourceInstanceId: "satori-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      result.cardInstances.filter(
        (c) => c.ownerPlayerId === "bob" && c.zone === "hand"
      ).length
    ).toBe(1);
  });

  it("配置時効果実行: トラッシュに地霊があるとき相手の手札が手元へ移る", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "satori-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    // alice トラッシュに地霊カード (X01 自身は導界者・地霊)
    const trashGeirei = createCardInstance(card, {
      instanceId: "trash-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const enemyHand = ["h1", "h2", "h3"].map((id) =>
      createCardInstance(cardNoMap.get("BSTH06-C01")!, {
        instanceId: id,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "hand",
      })
    );
    const placeEffect = card.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        e.steps[0]?.action.kind === "move_card"
    )!;
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, trashGeirei, ...enemyHand],
    };
    const result = runEffect(state, placeEffect, "satori-1", "alice");
    const bobHand = result.cardInstances.filter(
      (c) => c.ownerPlayerId === "bob" && c.zone === "hand"
    );
    const bobSetAside = result.cardInstances.filter(
      (c) => c.ownerPlayerId === "bob" && c.zone === "set_aside"
    );
    expect(bobHand.length).toBe(0);
    expect(bobSetAside.length).toBe(3);
  });
});

// ============================================================
// BSTH06-X02 古明地 こいし
// ============================================================
describe("BSTH06-X02 古明地 こいし", () => {
  const card = cardNoMap.get("BSTH06-X02")!;

  it("unblockable / 対象不可・含めない / アタック時 手元破棄→回復", () => {
    expect(card.effects![0]!.timingScope).toEqual({
      player: "self",
      period: "attack",
    });
    expect(card.effects![0]!.steps[0]!.action.kind).toBe("unblockable");
    expect(card.effects![1]!.timingScope).toEqual({
      player: "self",
      period: "attack",
    });
    const targetLock = card.effects![1]!.steps[0]!.action;
    expect(targetLock.kind).toBe("effect_resistance");
    if (targetLock.kind === "effect_resistance") {
      expect(targetLock.resistsOutcome).toEqual(["targeted", "included"]);
      expect(targetLock.source).toBe("opponent_effect");
    }
    const atk = card.effects![2]!;
    expect(atk.timing).toEqual({ kind: "card_event", event: "attack" });
    const discard = atk.steps[0]!.action;
    expect(discard.kind).toBe("discard");
    if (discard.kind === "discard") {
      expect(discard.player).toBe("opponent");
      expect(discard.fromZone).toBe("set_aside");
    }
    expect(atk.steps[1]!.connector).toBe("conditional_cost");
    expect(atk.steps[1]!.action.kind).toBe("recover");
  });

  it("アタック時に手元を破棄しても handCount は減らさず、状態 invariant を保つ", () => {
    const koishi = createCardInstance(card, {
      instanceId: "bsth06-x02-koishi-set-aside-discard",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
      exhaustState: "exhausted",
    });
    const bobSetAside = createCardInstance(cardNoMap.get("BSTH06-C01")!, {
      instanceId: "bsth06-x02-bob-set-aside",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "set_aside",
    });
    const bobHand = createCardInstance(cardNoMap.get("BSTH06-C02")!, {
      instanceId: "bsth06-x02-bob-hand-remains",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const base = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [koishi, bobSetAside, bobHand],
        playerOverrides: [
          { handCount: 0, deckCount: 0 },
          { handCount: 1, deckCount: 0 },
        ],
      }),
      activePlayerId: "alice",
      step: "attack" as const,
    };

    const after = runEffect(
      base,
      card.effects![2]!,
      koishi.instanceId,
      "alice"
    );

    expect(
      after.cardInstances.find(
        (entry) => entry.instanceId === bobSetAside.instanceId
      )?.zone
    ).toBe("trash");
    expect(after.players.find((player) => player.id === "bob")?.handCount).toBe(
      1
    );
    expect(
      after.cardInstances.filter(
        (entry) => entry.ownerPlayerId === "bob" && entry.zone === "hand"
      )
    ).toEqual([expect.objectContaining({ instanceId: bobHand.instanceId })]);
    expect(collectGameStateInvariantIssues(after)).toEqual([]);
    expect(
      after.cardInstances.find(
        (entry) => entry.instanceId === koishi.instanceId
      )?.exhaustState
    ).toBe("recovered");
  });

  it("BSTH06-X02 の対象不可は相手効果の target acquisition から自身を除外する", () => {
    const koishi = createCardInstance(card, {
      instanceId: "bsth06-x02-koishi",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const decoy = createCardInstance(cardNoMap.get("BSTH06-C01")!, {
      instanceId: "bsth06-x02-decoy",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const bobSource = createCardInstance(cardNoMap.get("BSTH06-C02")!, {
      instanceId: "bsth06-x02-bob-source",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const aliceSource = createCardInstance(cardNoMap.get("BSTH06-X01")!, {
      instanceId: "bsth06-x02-alice-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const base = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [koishi, decoy, bobSource, aliceSource],
      }),
      activePlayerId: "alice",
      step: "attack" as const,
    };
    const protectedState = runEffect(
      base,
      card.effects![1]!,
      koishi.instanceId,
      "alice"
    );
    expect(
      protectedState.activeContinuousEffects
        .filter((ce) => ce.targetInstanceId === koishi.instanceId)
        .map((ce) => ce.modifierTag)
    ).toEqual(["cannot_be_targeted", "cannot_include"]);
    const registration: RegisteredTargetedEffectActionBase = {
      candidateTargetZones: ["field"],
      candidateTargetPlayerScope: "opponent",
      targetCardFilter: { category: ["spirit"] },
      targetCardFilterActionKind: "destroy",
    };

    expect(
      getCandidateTargetInstanceIds(protectedState, "bob", registration, {
        getCardDefinitionById,
        sourceInstanceId: bobSource.instanceId,
      })
    ).toEqual([decoy.instanceId]);

    expect(
      getCandidateTargetInstanceIds(
        protectedState,
        "alice",
        { ...registration, candidateTargetPlayerScope: "acting_player" },
        {
          getCardDefinitionById,
          sourceInstanceId: aliceSource.instanceId,
        }
      )
    ).toEqual([koishi.instanceId, decoy.instanceId]);

    const destroyEffect: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          id: "destroy",
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
    };
    const ownDestroyEffect: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          id: "destroy",
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "self",
              filter: { category: ["spirit"] },
              count: 1,
            },
          },
        },
      ],
    };
    const includeAllDestroyEffect: NonNullable<
      CardDefinition["effects"]
    >[number] = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          id: "destroy-all",
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: "all",
            },
          },
        },
      ],
    };
    const afterLockedTarget = executeEffect({
      chainId: "test:bsth06-cards:1567",
      state: protectedState,
      effect: destroyEffect,
      sourceInstanceId: bobSource.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById,
      targetInstanceIds: [koishi.instanceId],
      targetStepId: "destroy",
    });
    const afterOpenTarget = executeEffect({
      chainId: "test:bsth06-cards:1576",
      state: protectedState,
      effect: destroyEffect,
      sourceInstanceId: bobSource.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById,
      targetInstanceIds: [decoy.instanceId],
      targetStepId: "destroy",
    });
    const afterAutoTarget = executeEffect({
      chainId: "test:bsth06-cards:1585",
      state: protectedState,
      effect: destroyEffect,
      sourceInstanceId: bobSource.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById,
    });
    const afterOwnTarget = executeEffect({
      chainId: "test:bsth06-cards:1592",
      state: protectedState,
      effect: ownDestroyEffect,
      sourceInstanceId: aliceSource.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: [koishi.instanceId],
      targetStepId: "destroy",
    });
    const afterIncludeAll = executeEffect({
      chainId: "test:bsth06-cards:1601",
      state: protectedState,
      effect: includeAllDestroyEffect,
      sourceInstanceId: bobSource.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById,
    });

    expect(
      afterLockedTarget.cardInstances.find(
        (instance) => instance.instanceId === koishi.instanceId
      )?.pendingLeaveKind
    ).toBeNull();
    expect(
      afterOpenTarget.cardInstances.find(
        (instance) => instance.instanceId === decoy.instanceId
      )?.pendingLeaveKind
    ).toBe("destroy");
    expect(
      afterAutoTarget.cardInstances.find(
        (instance) => instance.instanceId === koishi.instanceId
      )?.pendingLeaveKind
    ).toBeNull();
    expect(
      afterAutoTarget.cardInstances.find(
        (instance) => instance.instanceId === decoy.instanceId
      )?.pendingLeaveKind
    ).toBe("destroy");
    expect(
      afterOwnTarget.cardInstances.find(
        (instance) => instance.instanceId === koishi.instanceId
      )?.pendingLeaveKind
    ).toBe("destroy");
    expect(
      afterIncludeAll.cardInstances.find(
        (instance) => instance.instanceId === koishi.instanceId
      )?.pendingLeaveKind
    ).toBeNull();
    expect(
      afterIncludeAll.cardInstances.find(
        (instance) => instance.instanceId === decoy.instanceId
      )?.pendingLeaveKind
    ).toBe("destroy");

    const resistanceEffect = (
      resistsOutcome: "targeted" | "included"
    ): NonNullable<CardDefinition["effects"]>[number] => ({
      timing: { kind: "continuous" },
      timingScope: { player: "self", period: "attack" },
      steps: [
        {
          action: {
            kind: "effect_resistance",
            target: { kind: "self" },
            resistsOutcome,
            source: "opponent_effect",
            duration: { scope: "while_on_field" },
          },
        },
      ],
    });
    const buildDifferentialBase = () => {
      const diffKoishi = createCardInstance(cardNoMap.get("BSTH06-X02")!, {
        instanceId: "bsth06-x02-diff-koishi",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 2,
      });
      const diffDecoy = createCardInstance(cardNoMap.get("BSTH06-C01")!, {
        instanceId: "bsth06-x02-diff-decoy",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const diffBobSource = createCardInstance(cardNoMap.get("BSTH06-C02")!, {
        instanceId: "bsth06-x02-diff-bob-source",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      });
      return {
        state: {
          ...createEmptyGameState({
            playerIds: ["alice", "bob"],
            cardInstances: [diffKoishi, diffDecoy, diffBobSource],
          }),
          activePlayerId: "alice",
          step: "attack" as const,
        },
        koishiId: diffKoishi.instanceId,
        decoyId: diffDecoy.instanceId,
        bobSourceId: diffBobSource.instanceId,
      };
    };
    const targetedBase = buildDifferentialBase();
    const includedBase = buildDifferentialBase();
    const includedTargetBase = buildDifferentialBase();
    const targetedOnlyState = runEffect(
      targetedBase.state,
      resistanceEffect("targeted"),
      targetedBase.koishiId,
      "alice"
    );
    const includedOnlyState = runEffect(
      includedBase.state,
      resistanceEffect("included"),
      includedBase.koishiId,
      "alice"
    );
    const includedOnlyTargetState = runEffect(
      includedTargetBase.state,
      resistanceEffect("included"),
      includedTargetBase.koishiId,
      "alice"
    );
    expect(
      targetedOnlyState.activeContinuousEffects
        .filter((ce) => ce.targetInstanceId === targetedBase.koishiId)
        .map((ce) => ce.modifierTag)
    ).toEqual(["cannot_be_targeted"]);
    expect(
      includedOnlyState.activeContinuousEffects
        .filter((ce) => ce.targetInstanceId === includedBase.koishiId)
        .map((ce) => ce.modifierTag)
    ).toEqual(["cannot_include"]);
    const afterTargetedOnlyIncludeAll = executeEffect({
      chainId: "test:bsth06-cards:1729",
      state: targetedOnlyState,
      effect: includeAllDestroyEffect,
      sourceInstanceId: targetedBase.bobSourceId,
      actingPlayerId: "bob",
      getCardDefinitionById,
    });
    const afterIncludedOnlyIncludeAll = executeEffect({
      chainId: "test:bsth06-cards:1736",
      state: includedOnlyState,
      effect: includeAllDestroyEffect,
      sourceInstanceId: includedBase.bobSourceId,
      actingPlayerId: "bob",
      getCardDefinitionById,
    });
    const afterIncludedOnlyTarget = executeEffect({
      chainId: "test:bsth06-cards:1743",
      state: includedOnlyTargetState,
      effect: destroyEffect,
      sourceInstanceId: includedTargetBase.bobSourceId,
      actingPlayerId: "bob",
      getCardDefinitionById,
    });

    expect(
      afterTargetedOnlyIncludeAll.cardInstances.find(
        (instance) => instance.instanceId === targetedBase.koishiId
      )?.pendingLeaveKind
    ).toBe("destroy");
    expect(
      afterIncludedOnlyIncludeAll.cardInstances.find(
        (instance) => instance.instanceId === includedBase.koishiId
      )?.pendingLeaveKind
    ).toBeNull();
    expect(
      afterIncludedOnlyIncludeAll.cardInstances.find(
        (instance) => instance.instanceId === includedBase.decoyId
      )?.pendingLeaveKind
    ).toBe("destroy");
    expect(
      afterIncludedOnlyTarget.cardInstances.find(
        (instance) => instance.instanceId === includedTargetBase.koishiId
      )?.pendingLeaveKind
    ).toBe("destroy");
  });
});

// ============================================================
// BSTH06-X03 星熊 勇儀
// ============================================================
describe("BSTH06-X03 星熊 勇儀", () => {
  const card = cardNoMap.get("BSTH06-X03")!;
  const otherAttacker = cardNoMap.get("BSDB01-C02")!;
  const destroyTriggerTarget: CardDefinition = {
    cardNo: "TEST-BSTH06-X03-DESTROY-TRIGGER",
    name: "BSTH06-X03 破壊時誘発テストスピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "game_event", player: "self", event: "destroy" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ],
  };

  function makeBattleFlashState(options?: {
    yuugiAttackState?: "idle" | "attacking" | "blocking";
    primaryEntityId?: string;
    participantEntityIds?: string[];
    lowTargetDef?: CardDefinition;
  }) {
    const yuugiAttackState = options?.yuugiAttackState ?? "attacking";
    const participantEntityIds = options?.participantEntityIds ?? [
      "battle-entity:yuugi",
    ];
    const primaryEntityId =
      options?.primaryEntityId ?? participantEntityIds[0]!;
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(card, {
            instanceId: "yuugi",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 3,
            exhaustState:
              yuugiAttackState === "attacking" ? "exhausted" : "recovered",
          }),
          createCardInstance(otherAttacker, {
            instanceId: "other-attacker",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
            exhaustState: "exhausted",
          }),
          createCardInstance(
            options?.lowTargetDef ?? cardNoMap.get("BSDB01-C02")!,
            {
              instanceId: "low-bp",
              ownerPlayerId: "bob",
              controllerPlayerId: "bob",
              zone: "field",
              normalCoreCount: 1,
            }
          ),
          createCardInstance(card, {
            instanceId: "high-bp",
            ownerPlayerId: "bob",
            controllerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 4,
          }),
        ],
        battleEntities: [
          {
            entityId: "battle-entity:yuugi",
            memberInstanceIds: ["yuugi"],
            resolvedBp: 12000,
            resolvedSymbols: ["red"],
            attackState: yuugiAttackState,
          },
          {
            entityId: "battle-entity:other",
            memberInstanceIds: ["other-attacker"],
            resolvedBp: 5000,
            resolvedSymbols: ["red"],
            attackState: "attacking",
          },
        ],
        activeAttack: {
          attackId: "attack-1",
          primaryEntityId,
          participantEntityIds,
          groupMode: "single",
          target: { kind: "player", playerId: "bob" },
          blockAssignments: participantEntityIds.map((participantEntityId) => ({
            participantEntityId,
            blockedByEntityIds: [],
          })),
          symbolResolutionOrder: participantEntityIds,
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: {
            kind: "before_block",
            priorityPlayerId: "alice",
            consecutivePassCount: 0,
            stackResponseSourcePlayerId: "alice",
            pendingStackAction: null,
          },
        },
      }),
      step: "attack" as const,
      window: "flash_before_block" as const,
    };
  }

  function yuugiFlashActions(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...effectLookups,
    }).filter(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceCardNo === "BSTH06-X03" &&
        action.sourceInstanceId === "yuugi"
    );
  }

  it("コスト下限 floor:2 / 三歩必殺 connect_battle(maxUses:2、合計3回) / フラッシュBP以下破壊 + Lv3 BP+10000", () => {
    // 「2コスト以上支払わなければ召喚できない」= コスト軽減下限 floor:2（cost_modify）で解消。
    expect(card.effects![0]!.stub).toBeUndefined();
    const costFloor = card.effects![0]!.steps[0]!.action;
    expect(costFloor.kind).toBe("cost_modify");
    if (costFloor.kind === "cost_modify") {
      expect(costFloor.target).toEqual({ kind: "self" });
      expect(costFloor.modifier).toEqual({ floor: 2 });
    }
    // 【三歩必殺】10_rules/05c_connect-battle.md: 3回まで連続でバトルできる grant
    // (初回+継続2回=合計3回。maxUses は継続回数なので2)。
    expect(card.effects![1]!.stub).toBeUndefined();
    expect(card.effects![1]!.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
    const connectBattle = card.effects![1]!.steps[0]!.action;
    expect(connectBattle.kind).toBe("connect_battle");
    if (connectBattle.kind === "connect_battle") {
      expect(connectBattle.maxUses).toBe(2);
    }
    const flash = card.effects![2]!;
    expect(flash.stub).toBeUndefined();
    expect(flash.timingScope).toEqual({ player: "self", period: "attack" });
    expect(flash.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "in_battle", state: "attacking" },
    ]);
    expect(flash.usageLimit).toEqual({
      kind: "per_instance",
      duration: "battle",
    });
    const destroy = flash.steps[0]!.action;
    expect(destroy.kind).toBe("destroy");
    if (destroy.kind !== "destroy" || !("filter" in destroy.target)) {
      throw new Error("BSTH06-X03 destroy filter target expected");
    }
    expect(destroy.target.filter).toEqual({
      category: ["spirit", "ultimate"],
      maxBpSource: "self_effective_bp",
    });
    expect(destroy.suppressDestroyedEffects).toBe("destroyed_only");
    expect(flash.steps[1]!.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "x03-destroy",
    });
    const bp = card.effects![3]!;
    expect(bp.condition).toEqual([{ kind: "min_level", value: 3 }]);
    const action = bp.steps[0]!.action;
    expect(action.kind).toBe("bp_modify");
    if (action.kind === "bp_modify") expect(action.amount).toBe(10000);
  });

  it("[board] BSTH06-X03 effects[2]: 自身BP以下だけ破壊し、効果抑止付きで相手ライフ1個をリザーブへ置く", () => {
    const state = makeBattleFlashState();
    const beforeBob = state.players.find((p) => p.id === "bob")!;

    const after = runEffect(state, card.effects![2]!, "yuugi", "alice");

    const lowAfter = after.cardInstances.find(
      (c) => c.instanceId === "low-bp"
    )!;
    const highAfter = after.cardInstances.find(
      (c) => c.instanceId === "high-bp"
    )!;
    expect(lowAfter.pendingLeaveKind).toBe("destroy");
    expect(highAfter.pendingLeaveKind).toBeNull();
    const pending = after.pendingLeaveEntities.find(
      (entry) => entry.instanceId === "low-bp"
    );
    expect(pending?.suppressDestroyedEffects).toBe("destroyed_only");
    const bob = after.players.find((p) => p.id === "bob")!;
    expect(bob.lifeNormalCoreCount).toBe(beforeBob.lifeNormalCoreCount - 1);
    expect(bob.reserveNormalCoreCount).toBe(
      beforeBob.reserveNormalCoreCount + 1
    );
  });

  it("[board] BSTH06-X03 effects[2]: 破壊対象自身の破壊時効果は発揮されない", () => {
    const definitions = [...ALL_CARDS, destroyTriggerTarget];
    const getDef = (id: string) =>
      id === destroyTriggerTarget.cardNo
        ? destroyTriggerTarget
        : getCardDefinitionById(id);
    const getRegisteredTriggeredEffectActions =
      buildTriggeredEffectLookup(definitions);
    const state = makeBattleFlashState({ lowTargetDef: destroyTriggerTarget });

    const afterEffect = executeEffect({
      chainId: "test:bsth06-cards:1999",
      state,
      effect: card.effects![2]!,
      sourceInstanceId: "yuugi",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(
      afterEffect.pendingLeaveEntities.find(
        (entry) => entry.instanceId === "low-bp"
      )?.suppressDestroyedEffects
    ).toBe("destroyed_only");

    const unsuppressedAfterEffect: GameState = {
      ...afterEffect,
      pendingLeaveEntities: afterEffect.pendingLeaveEntities.map((entry) =>
        entry.instanceId === "low-bp"
          ? { ...entry, suppressDestroyedEffects: undefined }
          : entry
      ),
    };
    const unsuppressedQueued = collectAndQueueTriggerReactions({
      beforeState: state,
      afterState: unsuppressedAfterEffect,
      source: "action_resolution",
      chainId: "bsth06-x03-destroy-baseline",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
      causedByPlayerId: "alice",
      causedBySourceInstanceId: "yuugi",
    });
    expect(unsuppressedQueued.pendingTriggeredEffects).toHaveLength(1);
    expect(unsuppressedQueued.pendingTriggeredEffects[0]?.eventKind).toBe(
      "destroy"
    );
    expect(
      unsuppressedQueued.pendingTriggeredEffects[0]?.relatedInstanceId
    ).toBe("low-bp");
    expect(
      unsuppressedQueued.pendingTriggeredEffects[0]?.suppressedSourceInstanceIds
    ).toBeUndefined();

    const queued = collectAndQueueTriggerReactions({
      beforeState: state,
      afterState: afterEffect,
      source: "action_resolution",
      chainId: "bsth06-x03-destroy",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
      causedByPlayerId: "alice",
      causedBySourceInstanceId: "yuugi",
    });

    expect(queued.pendingTriggeredEffects).toHaveLength(0);
    expect(
      queued.log.some((entry) => entry.startsWith("trigger:effect-suppressed:"))
    ).toBe(true);
    expect(queued.players.find((p) => p.id === "bob")!.countValue).toBe(0);
  });

  it("[legal] BSTH06-X03 effects[2]: 勇儀自身のアタック中だけ提示され、同一バトル2回目は usageLimit で止まる", () => {
    const state = makeBattleFlashState();

    const firstActions = yuugiFlashActions(state);
    expect(firstActions).toHaveLength(1);
    expect(firstActions[0]!.timing).toBe("flash");
    expect(firstActions[0]!.candidateTargetInstanceIds).toContain("low-bp");
    expect(firstActions[0]!.candidateTargetInstanceIds).not.toContain(
      "high-bp"
    );

    const declared = applyLegalAction({
      state,
      action: firstActions[0]!,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    const sameBattleAfterDeclaration: GameState = {
      ...state,
      effectUsageRecords: declared.effectUsageRecords,
    };
    expect(yuugiFlashActions(sameBattleAfterDeclaration)).toHaveLength(0);

    const otherBattle = makeBattleFlashState({
      yuugiAttackState: "idle",
      primaryEntityId: "battle-entity:other",
      participantEntityIds: ["battle-entity:other"],
    });
    expect(yuugiFlashActions(otherBattle)).toHaveLength(0);
  });
});

// ============================================================
// BSTH06-転醒R01(A) 旧地獄街道 (転醒ネクサス)
// ============================================================
describe("BSTH06-転醒R01(A) 旧地獄街道", () => {
  const card = cardNoMap.get("BSTH06-転醒R01(A)")!;

  it("転醒トリガー(attack/exhaust/leave_field) rebirth(3) / 配置時ドロー / Lv2 赤treat_as / 両面", () => {
    expect(card.isDoubleSided).toBe(true);
    // [0] スピリットのアタック時（game_event:attack, spirit）
    expect(card.effects![0]!.timing).toEqual({
      kind: "game_event",
      player: "either",
      event: "attack",
      triggerFilter: { category: ["spirit"] },
    });
    // [1] スピリットの疲労時（game_event:exhaust, spirit）
    expect(card.effects![1]!.timing).toEqual({
      kind: "game_event",
      player: "either",
      event: "exhaust",
      triggerFilter: { category: ["spirit"] },
    });
    // [2] このネクサスが相手によって離れるとき（card_event:leave_field, opponent_effect）
    expect(card.effects![2]!.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    for (const idx of [0, 1, 2]) {
      const eff = card.effects![idx]!;
      expect(eff.executionMode).toBe("optional");
      expect(eff.condition).toEqual([
        { kind: "count_value", player: "self", max: 3 },
      ]);
      expect(eff.stub).toBeUndefined();
      const rebirth = eff.steps[0]!.action;
      expect(rebirth.kind).toBe("rebirth");
      if (rebirth.kind === "rebirth") expect(rebirth.maxCount).toBe(3);
    }
    // [3] 配置時ドロー
    expect(card.effects![3]!.timing).toEqual({
      kind: "card_event",
      event: "place",
    });
    expect(card.effects![3]!.steps[0]!.action.kind).toBe("draw");
    // [4] Lv2 赤 treat_as
    const treat = card.effects![4]!.steps[0]!.action;
    if (treat.kind === "treat_as") expect(treat.asColor).toBe("red");
  });
});

// ============================================================
// BSTH06-転醒X01(A) 核融合炉 (創界石/転醒ネクサス)
// ============================================================
describe("BSTH06-転醒X01(A) 核融合炉", () => {
  const card = cardNoMap.get("BSTH06-転醒X01(A)")!;

  it("grandstoneData(解封: 地霊のアタック, 転醒: コア4・カウント5・1個残しボイド・コア配置) + 神秘 restrict_end_attack_step", () => {
    expect(card.keywordTags).toContain("enter_field_core_placement_forbidden");
    const gs = card.grandstoneData!;
    expect(gs).toBeDefined();
    expect(gs.unsealConditions).toHaveLength(1);
    expect(gs.unsealConditions[0]!.events).toEqual(["attack"]);
    expect(gs.unsealConditions[0]!.cardFilter?.tribes).toEqual(["地霊"]);
    expect(gs.rebirthCoreThreshold).toBe(4);
    expect(gs.rebirthMaxCount).toBe(5);
    expect(gs.rebirthRetainCores).toBe(1);
    expect(gs.postRebirth).toBe("charge_cores_from_field_reserve");
    const mystic = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "restrict_end_attack_step"
    );
    expect(mystic).toBeDefined();
    // 創界石本体ルール・解封・転醒は grandstoneData で表現済み → stub なし
    expect(card.effects!.filter((e) => e.stub).length).toBe(0);
  });
});
