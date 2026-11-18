/**
 * BSTH002-C05「封魔録三面 固定砲台」effects[0] 検証。
 *
 * カード本文:
 * - 【ミラージュ：コスト3<白>（このカードは手札からセットできる）】
 * - 【セット中】『自分のメインステップ』
 *   系統：「封魔」を持つ自分のコスト3以上のスピリットが召喚されたとき、
 *   相手のスピリット/アルティメット1体を手札に戻せる。
 *
 * ルール根拠:
 * - 10_rules/03c: 「戻せる」は任意文言のため executionMode:"optional"。
 * - 10_rules/02: 常時以外の効果発揮はスタック窓を開くため、召喚後誘発は
 *   game_event:summon 登録にして既存 pending 経路へ乗せる。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
  generateTriggeredEffectRegistrations,
  getLegalActions,
  playSummonAsAction,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import {
  queuePendingReactionsFromTriggerEvents,
  type CollectedTriggerEvent,
} from "../src/effect/trigger-system";

const ALICE = "alice";
const BOB = "bob";

const C05 = ALL_CARDS.find((c) => c.cardNo === "BSTH002-C05")!;

const FUMA_COST3: CardDefinition = {
  cardNo: "TEST-BSTH002-C05-FUMA-COST3",
  name: "封魔召喚テスト",
  printedCategory: "spirit",
  colors: ["white"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["white"],
  textLines: [],
  keywordTags: [],
  tribe: "封魔",
  sourceUrls: [],
  sourceConfidence: "C",
};

const FUMA_COST2: CardDefinition = {
  ...FUMA_COST3,
  cardNo: "TEST-BSTH002-C05-FUMA-COST2",
  name: "低コスト封魔",
  cost: 2,
};

const NON_FUMA_COST3: CardDefinition = {
  ...FUMA_COST3,
  cardNo: "TEST-BSTH002-C05-NON-FUMA-COST3",
  name: "非封魔",
  tribe: "幻想",
};

const TARGET: CardDefinition = {
  ...FUMA_COST3,
  cardNo: "TEST-BSTH002-C05-TARGET",
  name: "戻される対象",
  cost: 1,
  tribe: "幻想",
};

const TEST_CARDS = [
  ...ALL_CARDS,
  FUMA_COST3,
  FUMA_COST2,
  NON_FUMA_COST3,
  TARGET,
];
const cardNoMap = new Map<string, CardDefinition>(
  TEST_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(TEST_CARDS);
const getRegisteredFieldCardEffectActions =
  buildFieldCardEffectLookup(TEST_CARDS);
const getRegisteredBurstActions = () => [];

function zoneOf(state: GameState, instanceId: string): string | undefined {
  return state.cardInstances.find((c) => c.instanceId === instanceId)?.zone;
}

function handCount(state: GameState, playerId: string): number {
  return state.players.find((p) => p.id === playerId)!.handCount;
}

function baseState(opts?: {
  sourceZone?: "mirage" | "field";
  summonedDefinition?: CardDefinition;
  activePlayerId?: string;
  bobHandCount?: number;
}): GameState {
  const sourceZone = opts?.sourceZone ?? "mirage";
  const summonedDefinition = opts?.summonedDefinition ?? FUMA_COST3;
  const bobHandCards = Array.from({ length: opts?.bobHandCount ?? 0 }, (_, i) =>
    createCardInstance(TARGET, {
      instanceId: `bob-hand-${i + 1}`,
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    })
  );
  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        { reserveNormalCoreCount: 6, voidNormalCoreCount: 10 },
        { handCount: opts?.bobHandCount ?? 0, reserveNormalCoreCount: 0 },
      ],
      cardInstances: [
        createCardInstance(C05, {
          instanceId: "c05-source",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: sourceZone,
        }),
        createCardInstance(summonedDefinition, {
          instanceId: "summoned-fuma",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "hand",
        }),
        createCardInstance(TARGET, {
          instanceId: "target",
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "field",
          normalCoreCount: 1,
        }),
        ...bobHandCards,
      ],
      mirageSetStates:
        sourceZone === "mirage"
          ? [{ playerId: ALICE, cardInstanceId: "c05-source" }]
          : [],
    }),
    activePlayerId: opts?.activePlayerId ?? ALICE,
    step: "main",
  };
}

function summonAndQueue(opts?: {
  sourceZone?: "mirage" | "field";
  summonedDefinition?: CardDefinition;
}): GameState {
  const summonedDefinition = opts?.summonedDefinition ?? FUMA_COST3;
  const result = playSummonAsAction({
    state: baseState(opts),
    actingPlayerId: ALICE,
    cardInstanceId: "summoned-fuma",
    paymentSources: [{ kind: "reserve", amount: summonedDefinition.cost }],
    enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions,
  });
  return result.state;
}

describe("BSTH002-C05 effects[0] shape (ミラージュ召喚時 bounce)", () => {
  const effect = C05.effects![0]!;

  it("mirageData: cost3/reduction white 宣言済み", () => {
    expect(C05.mirageData).toEqual({ cost: 3, reduction: ["white"] });
  });

  it("stub 解消済み、game_event:summon + 自分メイン + mirage_set 束縛 + 任意", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "summon",
      triggerFilter: {
        category: ["spirit"],
        tribes: ["封魔"],
        minCost: 3,
      },
    });
    expect(effect.timingScope).toEqual({ player: "self", period: "main" });
    expect(effect.applicability).toEqual({ zone: ["mirage_set"] });
    expect(effect.executionMode).toBe("optional");
  });

  it("steps[0] = 相手 spirit/ultimate 1体を手札へ bounce", () => {
    expect(effect.steps).toHaveLength(1);
    expect(effect.steps[0]!.action).toEqual({
      kind: "bounce",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: 1,
      },
    });
  });

  it("registration: sourceZone=mirage_set と timingScope が triggered 登録へ伝播する", () => {
    const regs = generateTriggeredEffectRegistrations(C05);
    const reg = regs.find((r) => r.effectIndex === 0);
    expect(reg).toMatchObject({
      eventKind: "summon",
      executionMode: "optional",
      sourceZone: ["mirage_set"],
      timingScope: { player: "self", period: "main" },
    });
    expect(reg?.eventMatcher).toEqual({
      family: "enter_field",
      actionKind: "summon",
      step: "main",
    });
  });
});

describe("BSTH002-C05 effects[0] 誘発と解決", () => {
  it("ミラージュセット中、自分メインで自分の封魔コスト3以上スピリット召喚時に公開 pending が積まれる", () => {
    const queued = summonAndQueue();
    expect(queued.pendingPrivateDeclarations).toHaveLength(0);
    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    expect(queued.pendingTriggeredEffects[0]).toMatchObject({
      actingPlayerId: ALICE,
      eventKind: "summon",
      relatedInstanceId: "summoned-fuma",
    });
    expect(
      queued.pendingTriggeredEffects[0]?.declaredFromPrivateZone
    ).toBeFalsy();
  });

  it("公開 pending は resolve_pending_triggered_effect からスタック窓を経て解決できる", () => {
    const queued = summonAndQueue();
    const resolve = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredFieldCardEffectActions,
      getRegisteredBurstActions,
    }).find((action) => action.kind === "resolve_pending_triggered_effect");

    expect(resolve).toMatchObject({
      kind: "resolve_pending_triggered_effect",
      sourceInstanceId: "c05-source",
      sourceCardNo: "BSTH002-C05",
    });
    const stackOpened = applyLegalAction({
      state: queued,
      action: resolve!,
      targetInstanceIds: ["target"],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredFieldCardEffectActions,
      getRegisteredBurstActions,
    }).state;

    expect(stackOpened.stackWindow).not.toBeNull();
    const pass = getLegalActions({
      state: stackOpened,
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredFieldCardEffectActions,
      getRegisteredBurstActions,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();

    const resolved = applyLegalAction({
      state: stackOpened,
      action: pass!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredFieldCardEffectActions,
      getRegisteredBurstActions,
    }).state;

    expect(zoneOf(resolved, "target")).toBe("hand");
    expect(handCount(resolved, BOB)).toBe(1);
  });

  it("ミラージュセット中でない / コスト2 / 非封魔 では誘発しない", () => {
    const expectNoQueuedTrigger = (state: GameState) => {
      expect(state.pendingPrivateDeclarations).toHaveLength(0);
      expect(state.pendingTriggeredEffects).toHaveLength(0);
    };

    expectNoQueuedTrigger(summonAndQueue({ sourceZone: "field" }));
    expectNoQueuedTrigger(summonAndQueue({ summonedDefinition: FUMA_COST2 }));
    expectNoQueuedTrigger(
      summonAndQueue({ summonedDefinition: NON_FUMA_COST3 })
    );
  });

  it("同じ enter_field family でも placement/advent では誘発しない", () => {
    const queueSyntheticEnterField = (
      actionKind: "placement" | "advent"
    ): GameState => {
      const event: CollectedTriggerEvent = {
        actingPlayerId: ALICE,
        eventKind: "summon",
        source: "action_resolution",
        chainId: "test:bsth002-c05-mirage-summon-bounce:312",
        attackId: null,
        relatedPlayerId: ALICE,
        relatedInstanceId: "summoned-fuma",
        amount: null,
        actionKind,
      };
      const initial = baseState();
      const state = {
        ...initial,
        cardInstances: initial.cardInstances.map((card) =>
          card.instanceId === "summoned-fuma"
            ? { ...card, zone: "field" as const, normalCoreCount: 1 }
            : card
        ),
      };
      return queuePendingReactionsFromTriggerEvents(state, [event], undefined, {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
      });
    };

    expect(
      queueSyntheticEnterField("placement").pendingTriggeredEffects
    ).toHaveLength(0);
    expect(
      queueSyntheticEnterField("advent").pendingTriggeredEffects
    ).toHaveLength(0);
  });

  it("executeEffect 直接実行でも選んだ相手スピリットを手札に戻す", () => {
    const after = flushPendingLeaves(
      executeEffect({
        chainId: "test:bsth002-c05-mirage-summon-bounce:349",
        state: baseState(),
        effect: C05.effects![0]!,
        effectIndex: 0,
        sourceInstanceId: "c05-source",
        actingPlayerId: ALICE,
        targetInstanceIds: ["target"],
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
      }),
      getCardDefinitionById
    );

    expect(zoneOf(after, "target")).toBe("hand");
    expect(handCount(after, BOB)).toBe(1);
  });
});

describe("BSTH002-C05 effects[1] 相手ターン hand_increase punish", () => {
  const effect = C05.effects![1]!;

  it("BSTH002-C05: 相手効果で相手手札が2枚増えたとき、2枚破棄を選ばせて1枚は残す", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({
      kind: "game_event",
      player: "opponent",
      event: "increase_hand",
      cause: ["self_effect"],
    });
    expect(effect.executionMode).toBe("mandatory");
    expect(effect.steps[0]!.action).toEqual({
      kind: "discard",
      player: "opponent",
      count: { source: { kind: "event_amount" } },
      targetHandSize: 1,
      capCount: { source: { kind: "event_amount" } },
    });

    const queued = queuePendingReactionsFromTriggerEvents(
      baseState({ sourceZone: "field", activePlayerId: BOB, bobHandCount: 3 }),
      [
        {
          actingPlayerId: BOB,
          eventKind: "increase_hand",
          source: "action_resolution",
          chainId: "test:bsth002-c05-mirage-summon-bounce:390",
          attackId: null,
          relatedPlayerId: BOB,
          relatedInstanceId: null,
          amount: 2,
          cause: "self_effect",
        },
      ],
      undefined,
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
      }
    );

    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    expect(queued.pendingTriggeredEffects[0]).toMatchObject({
      actingPlayerId: ALICE,
      eventKind: "increase_hand",
      relatedPlayerId: BOB,
      amount: 2,
    });

    const resolve = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredFieldCardEffectActions,
      getRegisteredBurstActions,
    }).find((action) => action.kind === "resolve_pending_triggered_effect");

    expect(resolve).toMatchObject({
      kind: "resolve_pending_triggered_effect",
      sourceInstanceId: "c05-source",
      sourceCardNo: "BSTH002-C05",
    });
    const stackOpened = applyLegalAction({
      state: queued,
      action: resolve!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredFieldCardEffectActions,
      getRegisteredBurstActions,
    }).state;
    expect(stackOpened.stackWindow).not.toBeNull();

    const pass = getLegalActions({
      state: stackOpened,
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredFieldCardEffectActions,
      getRegisteredBurstActions,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();

    const afterStack = applyLegalAction({
      state: stackOpened,
      action: pass!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredFieldCardEffectActions,
      getRegisteredBurstActions,
    }).state;

    const zoneSelection = afterStack.pendingZoneSelection!;
    expect(zoneSelection).toMatchObject({
      actingPlayerId: BOB,
      actionKind: "discard_hand",
      maxCount: 2,
      canSkip: false,
    });
    expect(zoneSelection.candidateCardInstanceIds).toHaveLength(3);

    const afterDiscard = applyLegalAction({
      state: afterStack,
      action: {
        kind: "resolve_pending_zone_selection",
        actionId: `zs-${zoneSelection.actionKind}`,
        can: true,
        reason: "test",
        actingPlayerId: zoneSelection.actingPlayerId,
        pendingId: zoneSelection.pendingId,
        actionKind: zoneSelection.actionKind,
        candidateCardInstanceIds: zoneSelection.candidateCardInstanceIds,
        maxCount: zoneSelection.maxCount,
        canSkip: zoneSelection.canSkip ?? true,
      },
      selectedZoneCardIds: zoneSelection.candidateCardInstanceIds.slice(0, 2),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;

    expect(handCount(afterDiscard, BOB)).toBe(1);
    expect(zoneOf(afterDiscard, "bob-hand-1")).toBe("trash");
    expect(zoneOf(afterDiscard, "bob-hand-2")).toBe("trash");
    expect(zoneOf(afterDiscard, "bob-hand-3")).toBe("hand");
  });

  it("BSTH002-C05: 自分ターンや相手の効果で増えた手札には誘発しない", () => {
    const event: CollectedTriggerEvent = {
      actingPlayerId: BOB,
      eventKind: "increase_hand",
      source: "action_resolution",
      chainId: "test:bsth002-c05-mirage-summon-bounce:496",
      attackId: null,
      relatedPlayerId: BOB,
      relatedInstanceId: null,
      amount: 2,
      cause: "self_effect",
    };
    const opts = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    };

    expect(
      queuePendingReactionsFromTriggerEvents(
        baseState({
          sourceZone: "field",
          activePlayerId: ALICE,
          bobHandCount: 3,
        }),
        [event],
        undefined,
        opts
      ).pendingTriggeredEffects
    ).toHaveLength(0);
    expect(
      queuePendingReactionsFromTriggerEvents(
        baseState({
          sourceZone: "field",
          activePlayerId: BOB,
          bobHandCount: 3,
        }),
        [{ ...event, cause: "opponent_effect" }],
        undefined,
        opts
      ).pendingTriggeredEffects
    ).toHaveLength(0);
  });
});
