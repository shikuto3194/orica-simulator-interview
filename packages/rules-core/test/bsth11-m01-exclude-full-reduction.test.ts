/**
 * BSTH11-M01 矢田寺 成美 effects[0]/[3] — フラッシュ『お互いのアタックステップ』
 * 手札/手元から召喚可能 + 「このとき」手札/手元の天璋/秘神カード1枚を除外することで、
 * このカードの軽減シンボルすべてを満たす。
 *
 * effects[0] = 自己召喚許可 (getHandSummonPermissionSpec)、effects[3] (配列末尾) = 継続
 * cost_modify + useCostPayment.kind:"exclude" fullReduction:true。
 * BSTH02.7-X02 (線形割引版、bsth02-7-x02-hand-summon-cost-exclude.test.ts) と同型だが、
 * 除外1枚の効果が線形割引ではなく costModifier:"full_reduction" 相当
 * (calculateFullReductionSummonCost) に合流する点が異なる
 * (ENGINE-summon-self-exclude-alt-cost-full-reduction)。除外元は「手札/手元」両方
 * (sourceZone:"hand_or_set_aside")。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildHandActivatedEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

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

const 矢田寺 = cardNoMap.get("BSTH11-M01")!; // cost:6, reductionSymbols:green×3+god
const 除外候補 = cardNoMap.get("BSTH11-C01")!; // tribe:幻想・天璋・妖精 (天璋を含む)

function makeSimpleSpirit(cardNo: string, bp: number): CardDefinition {
  return {
    cardNo,
    name: `test ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}
const BOB_ATTACKER = makeSimpleSpirit("TEST-BOB-ATTACKER-M01", 2000);

const ALICE = "alice";
const BOB = "bob";

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id) ?? (id === BOB_ATTACKER.cardNo ? BOB_ATTACKER : undefined);

/**
 * bob が alice を攻撃し、flash_before_block window で alice (非アクティブ) が
 * 最初の優先権を持つ状態 (bsth02-7-x02-hand-summon-cost-exclude.test.ts と同型)。
 * timingScope player:"both" のため相手のアタックステップでも許可 effect が現れる。
 */
function buildState(options: {
  candidateZone: "hand" | "set_aside" | null;
  reserveNormalCoreCount: number;
}): GameState {
  const candidateCards =
    options.candidateZone === null
      ? []
      : [
          createCardInstance(除外候補, {
            instanceId: "candidate-1",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: options.candidateZone,
          }),
        ];
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [
      createCardInstance(矢田寺, {
        instanceId: "yatadera-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      }),
      ...candidateCards,
      createCardInstance(BOB_ATTACKER, {
        instanceId: "bob-attacker",
        ownerPlayerId: BOB,
        zone: "field",
        cores: 1,
        exhaustState: "exhausted",
      }),
    ],
    playerOverrides: [
      { reserveNormalCoreCount: options.reserveNormalCoreCount },
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

describe("BSTH11-M01 フラッシュ手札召喚 + 手札/手元1枚除外で軽減シンボルすべてを満たす", () => {
  it("候補 (手元) がある場合、宣言後のスタック解決で fullReduction の除外選択 pending が出る", () => {
    const state = buildState({
      candidateZone: "set_aside",
      reserveNormalCoreCount: 8,
    });
    const action = findHandEffectAction(state, "yatadera-1");
    expect(action).toBeDefined();
    expect(action?.registrationIndex).toBe(0);

    const opened = declareHandEffectAndPassStack(state, "yatadera-1");
    expect(opened.pendingSummonCostExcludeChoice).not.toBeNull();
    const pending = opened.pendingSummonCostExcludeChoice!;
    expect(pending.maxCount).toBe(1);
    expect(pending.fullReduction).toBe(true);
    expect(pending.sourceZone).toBe("hand_or_set_aside");
    expect(pending.effectSummonActivationZone).toBe("hand");
    expect(pending.candidateCardInstanceIds).toEqual(["candidate-1"]);
  });

  it("1枚 (手元) を除外選択: removed_from_game へ移動し、軽減シンボル4個分を満たしたfullReductionコスト(6-4=2)で召喚される", () => {
    const state = buildState({
      candidateZone: "set_aside",
      reserveNormalCoreCount: 8,
    });
    const opened = declareHandEffectAndPassStack(state, "yatadera-1");

    expect(opened.pendingSummonCostExcludeChoice).not.toBeNull();
    const pending = opened.pendingSummonCostExcludeChoice!;
    expect(pending.fullReduction).toBe(true);

    const resolveAction = actionsFor(opened, ALICE).find(
      (a) => a.kind === "resolve_pending_summon_cost_exclude_choice"
    )!;
    const afterCostChoice = applyLegalAction({
      state: opened,
      action: resolveAction,
      getCardDefinitionById,
      ...effectLookups,
      summonCostExcludeSelectedCardInstanceIds: ["candidate-1"],
      // fullReduction: cost = printedCost(6) - reductionSymbols.length(4) = 2。
      paymentSources: [{ kind: "reserve", amount: 2 }],
    }).state;

    expect(afterCostChoice.pendingSummonCostExcludeChoice ?? null).toBeNull();
    expect(
      afterCostChoice.cardInstances.find((c) => c.instanceId === "candidate-1")!
        .zone
    ).toBe("removed_from_game");

    expect(afterCostChoice.pendingMultiPlacement).not.toBeNull();
    const resolved = resolvePendingMultiPlacementFromReserve(afterCostChoice);

    const card = resolved.cardInstances.find(
      (c) => c.instanceId === "yatadera-1"
    )!;
    expect(card.zone).toBe("field");
    // reserve: 8 - (2 支払い + 1 場入りコア) = 5。無地の軽減 (板上に緑シンボル無し) なら
    // 通常召喚は 6 コア全額かかるところ、fullReduction で 2 に軽減されたことを裏付ける。
    const alice = resolved.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(5);
  });

  it("0枚選択 (辞退): 除外なし、通常コスト(印字6、盤面軽減無し)で召喚される", () => {
    const state = buildState({
      candidateZone: "hand",
      reserveNormalCoreCount: 10,
    });
    const opened = declareHandEffectAndPassStack(state, "yatadera-1");
    const resolveAction = actionsFor(opened, ALICE).find(
      (a) => a.kind === "resolve_pending_summon_cost_exclude_choice"
    )!;

    const afterCostChoice = applyLegalAction({
      state: opened,
      action: resolveAction,
      getCardDefinitionById,
      ...effectLookups,
      summonCostExcludeSelectedCardInstanceIds: [],
      paymentSources: [{ kind: "reserve", amount: 6 }],
    }).state;

    expect(afterCostChoice.pendingSummonCostExcludeChoice ?? null).toBeNull();
    expect(
      afterCostChoice.cardInstances.find((c) => c.instanceId === "candidate-1")!
        .zone
    ).toBe("hand");

    expect(afterCostChoice.pendingMultiPlacement).not.toBeNull();
    const resolved = resolvePendingMultiPlacementFromReserve(afterCostChoice);

    const card = resolved.cardInstances.find(
      (c) => c.instanceId === "yatadera-1"
    )!;
    expect(card.zone).toBe("field");
    // reserve: 10 - (6 支払い + 1 場入りコア) = 3。
    const alice = resolved.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(3);
  });

  it("候補が無い場合は除外選択を開かず、通常支払いで召喚される", () => {
    const state = buildState({
      candidateZone: null,
      reserveNormalCoreCount: 8,
    });
    expect(findHandEffectAction(state, "yatadera-1")).toBeDefined();

    const opened = declareHandEffectAndPassStack(state, "yatadera-1");
    expect(opened.pendingSummonCostExcludeChoice).toBeNull();
    expect(opened.pendingEffectSummonCostPayment).toBeNull();
    expect(opened.pendingMultiPlacement).not.toBeNull();
    const resolved = resolvePendingMultiPlacementFromReserve(opened);
    expect(resolved.pendingMultiPlacement).toBeNull();
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "yatadera-1")?.zone
    ).toBe("field");
    expect(
      resolved.players.find((p) => p.id === ALICE)?.reserveNormalCoreCount
    ).toBe(1);
  });
});
