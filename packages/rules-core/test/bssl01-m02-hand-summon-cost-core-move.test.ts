/**
 * BSSL01-M02 ベル effects[0,1] — フラッシュ【烈神憑・影】『お互いのアタックステップ』
 * 〔ターンに1回：同名〕手札にあるこのカードは、自分の煌臨中の「水篠 旬」がいるとき、
 * 自分のカウント5以上なら、自分のトラッシュのコア5個以上をフィールド/リザーブに置くことで、
 * コストを支払わずに召喚する。
 *
 * effects[0] = 自己召喚許可 (getHandSummonPermissionSpec)、effects[1] = 継続
 * cost_modify + useCostPayment.kind:"core_move"（BSFT01-X01/BSTH02.7-X02/BSSL01-X03 と
 * 同じ2effect分離アーキテクチャ。engine-hand-summon-alt-cost-core-payment）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  executeEffect,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildHandActivatedEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  createActionInputDecisionNode,
} from "../src";
import type { CardDefinition, CardInstance, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredHandActivatedEffectActions:
    buildHandActivatedEffectLookup(ALL_CARDS),
};

const ベル = cardNoMap.get("BSSL01-M02")!;

// 「水篠 旬」本体を探す（cardNo は BSSL01 内で不明なため name 一致で探索）。
const 水篠旬本体 = ALL_CARDS.find((c) => c.name === "水篠 旬")!;

function makeSimpleSpirit(cardNo: string, bp: number): CardDefinition {
  return {
    cardNo,
    name: `test ${cardNo}`,
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp }],
    symbolColors: ["purple"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}
const BOB_ATTACKER = makeSimpleSpirit("TEST-BOB-ATTACKER-M02", 2000);

const ALICE = "alice";
const BOB = "bob";

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id) ?? (id === BOB_ATTACKER.cardNo ? BOB_ATTACKER : undefined);

/**
 * bob が alice を攻撃し、flash_before_block window で alice が最初の優先権を持つ状態
 * (bsth02-7-x02-hand-summon-cost-exclude.test.ts と同型セットアップ)。
 * alice の場には煌臨中の「水篠 旬」を置く。
 */
function buildState(options: {
  trashNormalCoreCount: number;
  reserveNormalCoreCount: number;
  countValue: number;
}): GameState {
  const 水篠旬Host: CardInstance = {
    ...createCardInstance(水篠旬本体, {
      instanceId: "mizushino-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    }),
    underCards: [
      { cardInstanceId: "mizushino-advent-source", role: "advent_source" },
    ],
  };
  const 水篠旬Source = createCardInstance(水篠旬本体, {
    instanceId: "mizushino-advent-source",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });

  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [
      createCardInstance(ベル, {
        instanceId: "bell-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      }),
      水篠旬Host,
      水篠旬Source,
      createCardInstance(BOB_ATTACKER, {
        instanceId: "bob-attacker",
        ownerPlayerId: BOB,
        zone: "field",
        cores: 1,
        exhaustState: "exhausted",
      }),
    ],
    playerOverrides: [
      {
        reserveNormalCoreCount: options.reserveNormalCoreCount,
        trashNormalCoreCount: options.trashNormalCoreCount,
        countValue: options.countValue,
      },
      { deckCount: 5 },
    ],
    battleEntities: [
      {
        entityId: "battle-entity:bob-attacker",
        memberInstanceIds: ["bob-attacker"],
        resolvedBp: 2000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "attack-group:1:bob:battle-entity:bob-attacker",
      primaryEntityId: "battle-entity:bob-attacker",
      participantEntityIds: ["battle-entity:bob-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: ALICE },
      blockAssignments: [
        {
          participantEntityId: "battle-entity:bob-attacker",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["battle-entity:bob-attacker"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: ALICE,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: ALICE,
        pendingStackAction: null,
      },
    },
  });
  return {
    ...base,
    step: "attack",
    window: "flash_before_block",
    activePlayerId: BOB,
  };
}

function actionsFor(state: GameState, actingPlayerId: string) {
  return getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById,
    ...effectLookups,
  });
}

function findHandEffectAction(state: GameState, sourceInstanceId: string) {
  return actionsFor(state, ALICE).find(
    (a): a is Extract<typeof a, { kind: "use_hand_card_effect" }> =>
      a.kind === "use_hand_card_effect" &&
      a.sourceInstanceId === sourceInstanceId
  );
}

function declareHandEffectAndPassStack(
  state: GameState,
  sourceInstanceId: string
): GameState {
  const action = findHandEffectAction(state, sourceInstanceId);
  expect(action).toBeDefined();
  const opened = applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById,
    ...effectLookups,
  }).state;
  expect(
    opened.cardInstances.find((c) => c.instanceId === sourceInstanceId)?.zone
  ).toBe("in_use");
  const passBob = actionsFor(opened, BOB).find(
    (a) => a.kind === "pass_battle_flash"
  );
  expect(passBob).toBeDefined();
  return applyLegalAction({
    state: opened,
    action: passBob!,
    getCardDefinitionById,
    ...effectLookups,
  }).state;
}

function resolvePendingMultiPlacementFromReserve(state: GameState): GameState {
  const pending = state.pendingMultiPlacement;
  expect(pending).not.toBeNull();
  const action = actionsFor(state, ALICE).find(
    (a) => a.kind === "resolve_pending_multi_placement"
  );
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById,
    ...effectLookups,
    multiPlacementAllocations: pending!.targets.map((target) => ({
      destinationInstanceId: target.instanceId,
      placements:
        target.minimumCoreCount > 0
          ? [{ kind: "reserve_normal", amount: target.minimumCoreCount }]
          : [],
    })),
  }).state;
}

describe("BSSL01-M02 フラッシュ手札召喚 + トラッシュコア移動代替コスト", () => {
  it("無償召喚でも自分のコスト下限2を支払う", () => {
    const modified: CardDefinition = {
      ...ベル,
      effects: [
        ...ベル.effects,
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "cost_modify",
                target: { kind: "self" },
                modifier: { floor: 2 },
                duration: { scope: "permanent" },
              },
            },
          ],
        },
      ],
    };
    cardNoMap.set(ベル.cardNo, modified);
    try {
      const opened = declareHandEffectAndPassStack(
        buildState({
          trashNormalCoreCount: 5,
          reserveNormalCoreCount: 0,
          countValue: 5,
        }),
        "bell-1"
      );
      const action = actionsFor(opened, ALICE).find(
        (a) => a.kind === "resolve_pending_summon_cost_core_move_choice"
      )!;
      expect(action).toMatchObject({
        grantsFreeSummon: true,
        remainingPaymentCost: 2,
      });
      const after = applyLegalAction({
        state: opened,
        action,
        getCardDefinitionById,
        ...effectLookups,
        summonCostCoreMoveSelectedCount: 5,
        summonCostCoreMoveDestination: "reserve",
        paymentSources: [{ kind: "reserve", amount: 2 }],
      }).state;
      expect(after.players[0]!.reserveNormalCoreCount).toBe(3);
      expect(
        resolvePendingMultiPlacementFromReserve(after).players[0]!
          .reserveNormalCoreCount
      ).toBe(2);
    } finally {
      cardNoMap.set(ベル.cardNo, ベル);
    }
  });
  it.each([
    {
      label: "コスト+20",
      modifier: { additionalCostValue: 20 },
      extra: false,
      payment: 0,
    },
    {
      label: "コスト30に変更",
      modifier: { override: 30 },
      extra: false,
      payment: 0,
    },
    {
      label: "3コスト余分に支払う",
      modifier: { additionalCostValue: 3 },
      extra: true,
      payment: 3,
    },
  ])(
    "$label: トラッシュコア移動後に必要な支払いだけを残す",
    ({ modifier, extra, payment }) => {
      const def: CardDefinition = {
        ...BOB_ATTACKER,
        cardNo: "BELL-COST-TEST",
        effects: [
          {
            timing: { kind: "continuous" },
            steps: [
              {
                action: {
                  kind: "cost_modify",
                  player: "self",
                  cardFilter: { category: ["spirit"] },
                  modifier,
                  additionalPayment: extra,
                  duration: { scope: "while_on_field" },
                },
              },
            ],
          },
        ],
      };
      cardNoMap.set(def.cardNo, def);
      let state = buildState({
        trashNormalCoreCount: 5,
        reserveNormalCoreCount: 0,
        countValue: 5,
      });
      state.cardInstances.push(
        createCardInstance(def, {
          instanceId: "cost-source",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        })
      );
      state = executeEffect({
        chainId: "test:bssl01-m02-hand-summon-cost-core-move:346",
        state,
        effect: def.effects[0]!,
        sourceInstanceId: "cost-source",
        actingPlayerId: ALICE,
        getCardDefinitionById,
      });
      const opened = declareHandEffectAndPassStack(state, "bell-1");
      const action = actionsFor(opened, ALICE).find(
        (a) => a.kind === "resolve_pending_summon_cost_core_move_choice"
      )!;
      expect(
        opened.pendingSummonCostCoreMoveChoice!
          .fieldDestinationCandidateInstanceIds
      ).not.toContain("mizushino-advent-source");
      const after = applyLegalAction({
        state: opened,
        action,
        getCardDefinitionById,
        ...effectLookups,
        summonCostCoreMoveSelectedCount: 5,
        summonCostCoreMoveAllocations: [
          { destination: "reserve", normalCount: 5 },
        ],
        paymentSources: payment ? [{ kind: "reserve", amount: payment }] : [],
      }).state;
      expect(after.players[0]!.reserveNormalCoreCount).toBe(5 - payment);
      const final = resolvePendingMultiPlacementFromReserve(after);
      expect(
        final.cardInstances.find((c) => c.instanceId === "bell-1")?.zone
      ).toBe("field");
      expect(final.players[0]!.reserveNormalCoreCount).toBe(4 - payment);
      if (payment > 0) {
        const queued = applyLegalAction({
          state: opened,
          action,
          getCardDefinitionById,
          ...effectLookups,
          summonCostCoreMoveSelectedCount: 5,
          summonCostCoreMoveAllocations: [
            { destination: "reserve", normalCount: 5 },
          ],
        }).state;
        expect(queued.pendingEffectSummonCostPayment?.requiredCost).toBe(
          payment
        );
        const pay = actionsFor(queued, ALICE).find(
          (a) => a.kind === "resolve_pending_effect_summon_cost_payment"
        )!;
        const paid = applyLegalAction({
          state: queued,
          action: pay,
          getCardDefinitionById,
          ...effectLookups,
          summonPaymentSources: [{ kind: "reserve", amount: payment }],
        }).state;
        expect(
          resolvePendingMultiPlacementFromReserve(paid).players[0]!
            .reserveNormalCoreCount
        ).toBe(4 - payment);
      }
    }
  );
  it("通常コアを二つのフィールドカードとリザーブへ、ソウルを別の対象へ配分する", () => {
    const state = buildState({
      trashNormalCoreCount: 5,
      reserveNormalCoreCount: 0,
      countValue: 5,
    });
    state.players[0]!.soulCoreLocation = { kind: "trash" };
    state.players[0]!.trashSoulCoreCount = 1;
    state.cardInstances.push(
      createCardInstance(BOB_ATTACKER, {
        instanceId: "second",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const opened = declareHandEffectAndPassStack(state, "bell-1");
    const action = actionsFor(opened, ALICE).find(
      (a) => a.kind === "resolve_pending_summon_cost_core_move_choice"
    )!;
    const node = createActionInputDecisionNode(opened, action, {
      getCardDefinitionById,
      maxGeneratedChoices: 1024,
    });
    expect(node?.fields).toContain("summonCostCoreMoveAllocations");
    expect(
      node?.choices.some(
        (choice) =>
          (choice.applyOptions?.summonCostCoreMoveAllocations?.length ?? 0) > 1
      )
    ).toBe(true);
    const payload = {
      summonCostCoreMoveSelectedCount: 6,
      summonCostCoreMoveAllocations: [
        { destination: "reserve" as const, normalCount: 1 },
        {
          destination: { fieldCardInstanceId: "mizushino-host" },
          normalCount: 2,
        },
        {
          destination: { fieldCardInstanceId: "second" },
          normalCount: 2,
          soulCount: 1 as const,
        },
      ],
      paymentSources: [],
    };
    const after = applyLegalAction({
      state: opened,
      action,
      getCardDefinitionById,
      ...effectLookups,
      ...payload,
    }).state;
    expect(
      after.cardInstances.find((c) => c.instanceId === "mizushino-host")
        ?.normalCoreCount
    ).toBe(3);
    expect(
      after.cardInstances.find((c) => c.instanceId === "second")
    ).toMatchObject({ normalCoreCount: 3, soulCoreCount: 1 });
    expect(after.players[0]!.trashNormalCoreCount).toBe(0);
    const final = resolvePendingMultiPlacementFromReserve(after);
    expect(final.players[0]!.reserveNormalCoreCount).toBe(0);
    expect(() =>
      applyLegalAction({
        state: opened,
        action,
        getCardDefinitionById,
        ...effectLookups,
        ...payload,
        summonCostCoreMoveSelectedCount: 5,
      })
    ).toThrow(/allocation/);
    expect(() =>
      applyLegalAction({
        state: opened,
        action,
        getCardDefinitionById,
        ...effectLookups,
        ...payload,
        summonCostCoreMoveAllocations: [
          {
            destination: { fieldCardInstanceId: "bob-attacker" },
            normalCount: 5,
            soulCount: 1,
          },
        ],
      })
    ).toThrow(/candidate/);
    expect(() =>
      applyLegalAction({
        state: opened,
        action,
        getCardDefinitionById,
        ...effectLookups,
        ...payload,
        summonCostCoreMoveAllocations: [
          {
            destination: { fieldCardInstanceId: "mizushino-advent-source" },
            normalCount: 5,
            soulCount: 1,
          },
        ],
      })
    ).toThrow(/candidate/);
  });
  it("条件成立 (煌臨中の水篠旬+カウント5+トラッシュコア5個) で use_hand_card_effect が出る", () => {
    const state = buildState({
      trashNormalCoreCount: 6,
      reserveNormalCoreCount: 8,
      countValue: 5,
    });
    const action = findHandEffectAction(state, "bell-1");
    expect(action).toBeDefined();
    expect(action?.registrationIndex).toBe(0);
  });

  it("カウント5未満なら許可 effect 自体が出ない", () => {
    const state = buildState({
      trashNormalCoreCount: 6,
      reserveNormalCoreCount: 8,
      countValue: 4,
    });
    expect(findHandEffectAction(state, "bell-1")).toBeUndefined();
  });

  it("トラッシュのコアが5個未満なら許可 effect 自体が出ない（通常コストへのフォールバック無し）", () => {
    const state = buildState({
      trashNormalCoreCount: 4,
      reserveNormalCoreCount: 8,
      countValue: 5,
    });
    expect(findHandEffectAction(state, "bell-1")).toBeUndefined();
  });

  it("5個移動をリザーブへ選択: トラッシュ→リザーブへコア移動しコスト0で召喚、attack step でもスタック窓が開いて召喚される", () => {
    // 既存の一括移動入力も維持し、リザーブを召喚コストには使わない。
    const state = buildState({
      trashNormalCoreCount: 6,
      reserveNormalCoreCount: 9,
      countValue: 5,
    });
    const opened = declareHandEffectAndPassStack(state, "bell-1");
    expect(opened.pendingSummonCostCoreMoveChoice).not.toBeNull();
    const pending = opened.pendingSummonCostCoreMoveChoice!;
    expect(pending.minCount).toBe(5);
    expect(pending.availableCoreCount).toBe(6);
    expect(pending.grantsFreeSummon).toBe(true);

    const resolveAction = actionsFor(opened, ALICE).find(
      (a) => a.kind === "resolve_pending_summon_cost_core_move_choice"
    )!;
    const afterCoreMoveChoice = applyLegalAction({
      state: opened,
      action: resolveAction,
      getCardDefinitionById,
      ...effectLookups,
      summonCostCoreMoveSelectedCount: 5,
      summonCostCoreMoveDestination: "reserve",
      paymentSources: [],
    }).state;

    expect(
      afterCoreMoveChoice.pendingSummonCostCoreMoveChoice ?? null
    ).toBeNull();
    const aliceAfterMove = afterCoreMoveChoice.players.find(
      (p) => p.id === ALICE
    )!;
    expect(aliceAfterMove.trashNormalCoreCount).toBe(1);
    expect(aliceAfterMove.reserveNormalCoreCount).toBe(14);

    expect(afterCoreMoveChoice.pendingMultiPlacement).not.toBeNull();
    const resolved =
      resolvePendingMultiPlacementFromReserve(afterCoreMoveChoice);

    const card = resolved.cardInstances.find((c) => c.instanceId === "bell-1")!;
    expect(card.zone).toBe("field");
    // reserve: 移動後14 - 場入りコア1 = 13。代替支払いにより召喚コストの reserve 消費は0。
    const aliceFinal = resolved.players.find((p) => p.id === ALICE)!;
    expect(aliceFinal.reserveNormalCoreCount).toBe(13);
  });

  it("6個移動を自分のフィールドカード(水篠旬host)へ選択: 指定カードにコアが乗る", () => {
    const state = buildState({
      trashNormalCoreCount: 6,
      reserveNormalCoreCount: 9,
      countValue: 5,
    });
    const opened = declareHandEffectAndPassStack(state, "bell-1");
    const resolveAction = actionsFor(opened, ALICE).find(
      (a) => a.kind === "resolve_pending_summon_cost_core_move_choice"
    )!;
    expect(resolveAction.kind).toBe(
      "resolve_pending_summon_cost_core_move_choice"
    );
    if (resolveAction.kind !== "resolve_pending_summon_cost_core_move_choice")
      return;
    expect(resolveAction.fieldDestinationCandidateInstanceIds).toContain(
      "mizushino-host"
    );

    const afterCoreMoveChoice = applyLegalAction({
      state: opened,
      action: resolveAction,
      getCardDefinitionById,
      ...effectLookups,
      summonCostCoreMoveSelectedCount: 6,
      summonCostCoreMoveDestination: {
        fieldCardInstanceId: "mizushino-host",
      },
      paymentSources: [],
    }).state;

    const host = afterCoreMoveChoice.cardInstances.find(
      (c) => c.instanceId === "mizushino-host"
    )!;
    expect(host.normalCoreCount).toBe(1 + 6);
    const aliceAfterMove = afterCoreMoveChoice.players.find(
      (p) => p.id === ALICE
    )!;
    expect(aliceAfterMove.trashNormalCoreCount).toBe(0);
    expect(afterCoreMoveChoice.pendingMultiPlacement).not.toBeNull();
    const resolved =
      resolvePendingMultiPlacementFromReserve(afterCoreMoveChoice);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "bell-1")?.zone
    ).toBe("field");
  });

  it("〔ターンに1回：同名〕: 1回召喚した後は同ターン中に同名カード(bell-2)の召喚許可が出ない（usageLimit記録漏れ回帰防止）", () => {
    const state = buildState({
      trashNormalCoreCount: 11,
      reserveNormalCoreCount: 9,
      countValue: 5,
    });
    const bell2 = createCardInstance(ベル, {
      instanceId: "bell-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const stateWithSecondBell: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, bell2],
    };

    const opened = declareHandEffectAndPassStack(stateWithSecondBell, "bell-1");
    const resolveAction = actionsFor(opened, ALICE).find(
      (a) => a.kind === "resolve_pending_summon_cost_core_move_choice"
    )!;
    const afterCoreMoveChoice = applyLegalAction({
      state: opened,
      action: resolveAction,
      getCardDefinitionById,
      ...effectLookups,
      summonCostCoreMoveSelectedCount: 5,
      summonCostCoreMoveDestination: "reserve",
      paymentSources: [],
    }).state;

    const resolved =
      resolvePendingMultiPlacementFromReserve(afterCoreMoveChoice);

    const bell1Card = resolved.cardInstances.find(
      (c) => c.instanceId === "bell-1"
    )!;
    expect(bell1Card.zone).toBe("field");

    // bell-2 は同名カードで、他条件（煌臨中の水篠旬/カウント5以上/トラッシュコア5個以上）は
    // 引き続き成立しているが、〔ターンに1回：同名〕を使い切っているため許可 effect 自体が
    // 出てはならない（修正前は summonPermissionUsageLimit が pending 解決経路で一切
    // recordEffectUsageIfLimited されず、同ターン内で無制限に召喚できてしまっていた）。
    expect(findHandEffectAction(resolved, "bell-2")).toBeUndefined();
  });
});
