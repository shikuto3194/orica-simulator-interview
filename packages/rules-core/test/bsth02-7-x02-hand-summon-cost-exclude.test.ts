/**
 * BSTH02.7-X02 上海人形 effects[0]/[1] — Lv1 フラッシュ『相手のアタックステップ』
 * 手札/手元から召喚可能 + 「このとき」トラッシュの黄1色幻想/導界者/導魔/動玩カード
 * 4枚まで除外、1枚につきコスト-1。
 *
 * effects[0] は即時効果の手札発揮。発揮宣言→スタック窓→除外コスト選択→
 * 効果内召喚・維持コア配置の順で処理し、内包召喚では二重のスタック窓を開かない。
 * effects[1] の cost_modify + useCostPayment.kind:"exclude" は効果解決時に参照する。
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
import { getSummonCostExcludeChoiceOption } from "../src/mechanics/summon-cost-exclude-choice";
import {
  collectAndQueueTriggerReactions,
  getAvailableTriggeredEffectSourceChoices,
} from "../src/effect/trigger-system";

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

const 上海人形 = cardNoMap.get("BSTH02.7-X02")!;
const 除外候補 = cardNoMap.get("BSTH02.7-C02")!; // tribe:幻想・動玩, colors:yellow (mono)

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
const BOB_ATTACKER = makeSimpleSpirit("TEST-BOB-ATTACKER", 2000);

const ALICE = "alice";
const BOB = "bob";

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id) ?? (id === BOB_ATTACKER.cardNo ? BOB_ATTACKER : undefined);

/**
 * bob が alice を攻撃し、flash_before_block window で alice (非アクティブ =
 * timingScope player:"opponent" の防御側) が最初の優先権を持つ状態。
 * BSES01 系 flash 効果の回帰テスト (battle-flash-active-player-flash-after-pass.test.ts)
 * と同型のセットアップ。
 */
function buildState(options: {
  trashCount: number;
  reserveNormalCoreCount: number;
  lifeNormalCoreCount?: number;
}): GameState {
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [
      createCardInstance(上海人形, {
        instanceId: "shanghai-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      }),
      ...Array.from({ length: options.trashCount }, (_, i) =>
        createCardInstance(除外候補, {
          instanceId: `trash-${i}`,
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "trash",
        })
      ),
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
        ...(options.lifeNormalCoreCount !== undefined
          ? { lifeNormalCoreCount: options.lifeNormalCoreCount }
          : {}),
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
      // 窓を開いた直後: 最初の優先権は非アクティブ (防御側) alice。
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

function findHandEffectAction(state: GameState) {
  return actionsFor(state, ALICE).find(
    (a): a is Extract<typeof a, { kind: "use_hand_card_effect" }> =>
      a.kind === "use_hand_card_effect" && a.sourceInstanceId === "shanghai-1"
  );
}

function declareHandEffectAndPassStack(state: GameState): GameState {
  const action = findHandEffectAction(state);
  expect(action).toBeDefined();
  const opened = applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById,
    ...effectLookups,
  }).state;
  expect(
    opened.cardInstances.find((c) => c.instanceId === "shanghai-1")?.zone
  ).toBe("in_use");
  expect(opened.window).toBe("stack_before_block");
  expect(opened.pendingSummonCostExcludeChoice).toBeNull();

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
          ? [
              {
                kind: "reserve_normal" as const,
                amount: target.minimumCoreCount,
              },
            ]
          : [],
    })),
  }).state;
}

describe("BSTH02.7-X02 フラッシュ手札召喚 + トラッシュ除外コスト軽減", () => {
  it("通常召喚や別の効果による召喚には除外割引を適用しない", () => {
    const state = buildState({ trashCount: 3, reserveNormalCoreCount: 8 });
    const source = state.cardInstances.find(
      (c) => c.instanceId === "shanghai-1"
    )!;
    expect(
      getSummonCostExcludeChoiceOption(
        state,
        ALICE,
        source,
        上海人形,
        getCardDefinitionById
      )
    ).toBeUndefined();
    expect(
      getSummonCostExcludeChoiceOption(
        state,
        ALICE,
        source,
        上海人形,
        getCardDefinitionById,
        undefined,
        3
      )
    ).toBeUndefined();
    expect(
      getSummonCostExcludeChoiceOption(
        state,
        ALICE,
        source,
        上海人形,
        getCardDefinitionById,
        undefined,
        0
      )?.maxCount
    ).toBe(4);
  });
  it.each([undefined, "shanghai-1", "bob-attacker"])(
    "召喚元 %s のとき、自己フラッシュ召喚でだけ3体アタック不可が誘発する",
    (sourceId) => {
      const before = buildState({ trashCount: 0, reserveNormalCoreCount: 8 });
      const after = {
        ...before,
        cardInstances: before.cardInstances.map((c) =>
          c.instanceId === "shanghai-1"
            ? {
                ...c,
                zone: "field" as const,
                zoneRoleName: "spirit" as const,
                normalCoreCount: 1,
              }
            : c
        ),
        log: [...before.log, "effect:summon:shanghai-1"],
      };
      const queued = collectAndQueueTriggerReactions({
        chainId: "test:bsth02-7-x02-hand-summon-cost-exclude:282",
        beforeState: before,
        afterState: after,
        source: "effect",
        getCardDefinitionById,
        ...effectLookups,
        getRegisteredBurstActions: undefined,
        ...(sourceId
          ? {
              sourceEffectIndex: 0,
              causedBySourceInstanceId: sourceId,
              enterFieldCausedByPlayerId: ALICE,
            }
          : {}),
      });
      const choices = queued.pendingTriggeredEffects.flatMap((pendingEffect) =>
        getAvailableTriggeredEffectSourceChoices({
          state: queued,
          pendingEffect,
          getCardDefinitionById,
          ...effectLookups,
        })
      );
      expect(
        choices.some((c) => c.sourceCard.instanceId === "shanghai-1")
      ).toBe(sourceId === "shanghai-1");
    }
  );
  it("相手のアタックステップでは通常召喚許可ではなく手札即時効果を1件だけ宣言する", () => {
    const state = buildState({ trashCount: 3, reserveNormalCoreCount: 8 });
    const actions = actionsFor(state, ALICE);
    const handEffects = actions.filter(
      (a) =>
        a.kind === "use_hand_card_effect" && a.sourceInstanceId === "shanghai-1"
    );
    expect(handEffects).toHaveLength(1);
    expect(handEffects[0]).toMatchObject({ registrationIndex: 0 });
    expect(
      actions.find(
        (a) => a.kind === "summon" && a.sourceInstanceId === "shanghai-1"
      )
    ).toBeUndefined();
  });

  it("2枚除外を選択: スタック後に除外してコスト7→5、続けて召喚・維持コア配置する", () => {
    const state = buildState({ trashCount: 3, reserveNormalCoreCount: 8 });
    const opened = declareHandEffectAndPassStack(state);

    expect(opened.pendingSummonCostExcludeChoice).not.toBeNull();
    const pending = opened.pendingSummonCostExcludeChoice!;
    expect(pending.maxCount).toBe(4);
    expect(pending.discountPerCard).toBe(1);
    expect(pending.effectSummonActivationZone).toBe("hand");
    expect(pending.candidateCardInstanceIds).toEqual([
      "trash-0",
      "trash-1",
      "trash-2",
    ]);

    const resolveAction = actionsFor(opened, ALICE).find(
      (a) => a.kind === "resolve_pending_summon_cost_exclude_choice"
    )!;
    const afterCostChoice = applyLegalAction({
      state: opened,
      action: resolveAction,
      getCardDefinitionById,
      ...effectLookups,
      summonCostExcludeSelectedCardInstanceIds: ["trash-0", "trash-1"],
      paymentSources: [{ kind: "reserve", amount: 5 }],
    }).state;

    expect(afterCostChoice.pendingSummonCostExcludeChoice ?? null).toBeNull();
    expect(
      afterCostChoice.cardInstances.find((c) => c.instanceId === "trash-0")!
        .zone
    ).toBe("removed_from_game");
    expect(
      afterCostChoice.cardInstances.find((c) => c.instanceId === "trash-1")!
        .zone
    ).toBe("removed_from_game");
    expect(
      afterCostChoice.cardInstances.find((c) => c.instanceId === "trash-2")!
        .zone
    ).toBe("trash");

    // 効果内召喚なので除外解決後に二重のスタック窓は開かず、維持コア配置へ進む。
    expect(afterCostChoice.window).toBe("flash_before_block");
    expect(afterCostChoice.stackWindow).toBeNull();
    expect(afterCostChoice.pendingMultiPlacement).not.toBeNull();
    const resolved = resolvePendingMultiPlacementFromReserve(afterCostChoice);

    const card = resolved.cardInstances.find(
      (c) => c.instanceId === "shanghai-1"
    )!;
    expect(card.zone).toBe("field");
    // reserve: 8 - (5 支払い + 1 場入りコア) = 2。
    const alice = resolved.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(2);
    expect(
      resolved.pendingTriggeredEffects
        .flatMap((pendingEffect) =>
          getAvailableTriggeredEffectSourceChoices({
            state: resolved,
            pendingEffect,
            getCardDefinitionById,
            ...effectLookups,
          })
        )
        .some((choice) => choice.sourceCard.instanceId === "shanghai-1")
    ).toBe(true);
  });

  it("効果召喚の支払いによる消滅誘発は元効果の原因を保持する", () => {
    let state = buildState({ trashCount: 3, reserveNormalCoreCount: 8 });
    const payer: CardDefinition = {
      ...BOB_ATTACKER,
      cardNo: "TEST-PAYER",
      effects: [
        {
          timing: { kind: "card_event", event: "vanish" },
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
    };
    const lookup = (id: string) =>
      id === payer.cardNo ? payer : getCardDefinitionById(id);
    const triggers = buildTriggeredEffectLookup([...ALL_CARDS, payer]);
    state = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(payer, {
          instanceId: "payer",
          ownerPlayerId: ALICE,
          zone: "field",
          cores: 5,
        }),
      ],
    };
    const actions = (state: GameState, actingPlayerId: string) =>
      getLegalActions({
        state,
        actingPlayerId,
        ...effectLookups,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggers,
      });
    const declaration = actions(state, ALICE).find(
      (a) =>
        a.kind === "use_hand_card_effect" && a.sourceInstanceId === "shanghai-1"
    )!;
    const window = applyLegalAction({
      state,
      action: declaration,
      ...effectLookups,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggers,
    }).state;
    const opened = applyLegalAction({
      state: window,
      action: actions(window, BOB).find((a) => a.kind === "pass_battle_flash")!,
      ...effectLookups,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggers,
    }).state;
    const action = actions(opened, ALICE).find(
      (a) => a.kind === "resolve_pending_summon_cost_exclude_choice"
    )!;
    const resolved = applyLegalAction({
      state: opened,
      action,
      ...effectLookups,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggers,
      summonCostExcludeSelectedCardInstanceIds: ["trash-0", "trash-1"],
      paymentSources: [{ kind: "card", instanceId: "payer", amount: 5 }],
    }).state;
    expect(resolved.pendingMultiPlacement).not.toBeNull();
    expect(
      resolved.pendingTriggeredEffects.filter((p) => p.eventKind === "vanish")
    ).toEqual([
      expect.objectContaining({
        chainId: opened.pendingSummonCostExcludeChoice!.effectSummonChainId,
      }),
    ]);
  });

  it("トラッシュに候補が無い場合も手札効果を宣言し、スタック後に通常コストで内包召喚する", () => {
    const state = buildState({ trashCount: 0, reserveNormalCoreCount: 8 });
    expect(findHandEffectAction(state)).toBeDefined();

    const afterStack = declareHandEffectAndPassStack(state);
    expect(afterStack.pendingSummonCostExcludeChoice).toBeNull();
    expect(afterStack.pendingEffectSummonCostPayment).toBeNull();
    expect(afterStack.pendingMultiPlacement).not.toBeNull();
    const resolved = resolvePendingMultiPlacementFromReserve(afterStack);
    expect(resolved.pendingMultiPlacement).toBeNull();
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "shanghai-1")?.zone
    ).toBe("field");
    expect(
      resolved.players.find((p) => p.id === ALICE)?.reserveNormalCoreCount
    ).toBe(0);
  });
});
