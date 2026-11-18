/**
 * engine-magic-field-pre-cost-payment-trigger: BSAZ01-C12「戦力投入」
 * 〔ターンに1回：同名〕『自分が系統：「地球」を持つマジックカードを使用するとき、
 * そのコストを支払う前に、ただちにメイン効果を使用できる。』
 *
 * 他カードのコスト支払いに割り込む cross-card トリガーの新規 primitive
 * (offer_magic_pre_cost_trigger CE + pendingFieldMagicPreCostTrigger +
 * resolve_field_magic_pre_cost_trigger legal action) を検証する。
 * メイン効果本体 (デッキ由来分身スピリット生成+自己配置) は
 * engine-deck-derived-clone-spirit.test.ts で別途検証済み。
 */
import { describe, expect, it } from "vitest";
import { BSAZ01_CARDS } from "../../card-data/src/cards/BSAZ01";
import {
  applyLegalAction,
  buildMagicLookup,
  createCardInstance,
  createEmptyGameState,
  createActionInputDecisionNode,
  executeEffect,
  getLegalActions,
  applyTrainingDecisionChoice,
} from "../src";
import type {
  CardDefinition,
  ContinuousEffect,
  Engine,
  GameState,
} from "../src";

const ALICE = "alice";
const BOB = "bob";

const C12_CARD = BSAZ01_CARDS.find((c) => c.cardNo === "BSAZ01-C12")!;
const C12_CONTINUOUS_TRIGGER_EFFECT = C12_CARD.effects!.find(
  (e) =>
    e.timing.kind === "continuous" &&
    e.steps.some((s) => s.action.kind === "offer_magic_pre_cost_trigger")
)!;

const EARTH_MAGIC: CardDefinition = {
  cardNo: "TEST-PRE-COST-EARTH-MAGIC",
  name: "テスト地球マジック",
  printedCategory: "magic",
  colors: ["yellow"],
  // C12 が自身の main 効果の完了後に field へ戻ると、field magic の動的な
  // 黄シンボルが再構築される。このカードはその 1 シンボルで支払いが 2 → 1 に
  // 変わるため、事前コスト誘発からの再開で古い支払いを使い回さない回帰ケースになる。
  cost: 2,
  reductionSymbols: ["yellow"],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "地球",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [{ timing: { kind: "activated", mode: "main" }, steps: [] }],
};

const NON_EARTH_MAGIC: CardDefinition = {
  ...EARTH_MAGIC,
  cardNo: "TEST-PRE-COST-NON-EARTH-MAGIC",
  tribe: "紅魔",
};

const FLASH_EARTH_MAGIC: CardDefinition = {
  ...EARTH_MAGIC,
  cardNo: "TEST-PRE-COST-FLASH-EARTH-MAGIC",
  name: "テスト地球フラッシュマジック",
  effects: [{ timing: { kind: "activated", mode: "flash" }, steps: [] }],
};

const STACK_EARTH_MAGIC: CardDefinition = {
  ...EARTH_MAGIC,
  cardNo: "TEST-PRE-COST-STACK-EARTH-MAGIC",
  name: "テスト地球スタックマジック",
  effects: [{ timing: { kind: "activated", mode: "stack" }, steps: [] }],
};

const UNPAYABLE_EARTH_MAGIC: CardDefinition = {
  ...EARTH_MAGIC,
  cardNo: "TEST-PRE-COST-UNPAYABLE-EARTH-MAGIC",
  name: "テスト支払い不能地球マジック",
  cost: 4,
  reductionSymbols: [],
};

const OPPONENT_STACK_MAGIC: CardDefinition = {
  ...EARTH_MAGIC,
  cardNo: "TEST-PRE-COST-OPPONENT-STACK-MAGIC",
  name: "テスト相手スタックマジック",
  tribe: undefined,
  cost: 0,
  reductionSymbols: [],
  effects: [
    {
      timing: { kind: "activated", mode: "stack" },
      steps: [],
    },
  ],
};

// 提示時は 0 コストだが、C12 の core_distribute 後に置かれて分身スピリットになる
// カード1枚につき追加コストが 1 増える。提示後の state 変化で finalCost が正数へ
// 上がったのに、提示時が 0 コストだったため支払い元が無い枝を再現する。
const FULLY_REDUCED_EARTH_MAGIC: CardDefinition = {
  ...EARTH_MAGIC,
  cardNo: "TEST-PRE-COST-FULLY-REDUCED-EARTH-MAGIC",
  name: "テスト全軽減地球マジック",
  cost: 0,
  reductionSymbols: [],
  effects: [
    {
      applicability: { zone: ["hand"] },
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "cost_modify",
            target: { kind: "self" },
            modifier: {
              additionalCostValue: {
                source: {
                  kind: "cards_in_zone",
                  zone: "field",
                  player: "self",
                  filter: { category: ["spirit"] },
                },
              },
            },
          },
        },
      ],
    },
    { timing: { kind: "activated", mode: "main" }, steps: [] },
  ],
};

const DECK_FILLER: CardDefinition = {
  cardNo: "TEST-PRE-COST-DECK-FILLER",
  name: "テストデッキフィラー",
  printedCategory: "magic",
  colors: ["yellow"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const cardMap = new Map<string, CardDefinition>(
  [
    C12_CARD,
    EARTH_MAGIC,
    NON_EARTH_MAGIC,
    FLASH_EARTH_MAGIC,
    STACK_EARTH_MAGIC,
    UNPAYABLE_EARTH_MAGIC,
    OPPONENT_STACK_MAGIC,
    FULLY_REDUCED_EARTH_MAGIC,
    DECK_FILLER,
  ].map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardMap.get(id);
const magicLookup = buildMagicLookup([
  C12_CARD,
  EARTH_MAGIC,
  NON_EARTH_MAGIC,
  FLASH_EARTH_MAGIC,
  STACK_EARTH_MAGIC,
  UNPAYABLE_EARTH_MAGIC,
  OPPONENT_STACK_MAGIC,
  FULLY_REDUCED_EARTH_MAGIC,
  DECK_FILLER,
]);

const trainingEngine: Engine = {
  cards: [
    C12_CARD,
    EARTH_MAGIC,
    NON_EARTH_MAGIC,
    FLASH_EARTH_MAGIC,
    STACK_EARTH_MAGIC,
    UNPAYABLE_EARTH_MAGIC,
    OPPONENT_STACK_MAGIC,
    FULLY_REDUCED_EARTH_MAGIC,
    DECK_FILLER,
  ],
  getCardDefinitionById,
  lookups: {
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => [],
    getRegisteredBattleImmediateEffectActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredHandActivatedEffectActions: () => [],
    getRegisteredMagicActions: magicLookup,
  },
};

function buildState(): { state: GameState; c12Id: string } {
  const c12 = createCardInstance(C12_CARD, {
    instanceId: "c12-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
  });
  const earthMagic = createCardInstance(EARTH_MAGIC, {
    instanceId: "earth-magic-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const earthMagic2 = createCardInstance(EARTH_MAGIC, {
    instanceId: "earth-magic-2",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const nonEarthMagic = createCardInstance(NON_EARTH_MAGIC, {
    instanceId: "non-earth-magic-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const flashEarthMagic = createCardInstance(FLASH_EARTH_MAGIC, {
    instanceId: "flash-earth-magic-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const stackEarthMagic = createCardInstance(STACK_EARTH_MAGIC, {
    instanceId: "stack-earth-magic-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const unpayableEarthMagic = createCardInstance(UNPAYABLE_EARTH_MAGIC, {
    instanceId: "unpayable-earth-magic-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const fullyReducedEarthMagic = createCardInstance(FULLY_REDUCED_EARTH_MAGIC, {
    instanceId: "fully-reduced-earth-magic-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const opponentStackMagic = createCardInstance(OPPONENT_STACK_MAGIC, {
    instanceId: "opponent-stack-magic-1",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "hand",
  });
  const deckCards = Array.from({ length: 3 }, (_, i) =>
    createCardInstance(DECK_FILLER, {
      instanceId: `deck-filler-${i}`,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    })
  );

  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [
      c12,
      earthMagic,
      earthMagic2,
      nonEarthMagic,
      flashEarthMagic,
      stackEarthMagic,
      unpayableEarthMagic,
      fullyReducedEarthMagic,
      opponentStackMagic,
      ...deckCards,
    ],
    playerOverrides: [
      { reserveNormalCoreCount: 10, handCount: 5, deckCount: 3 },
      { handCount: 1 },
    ],
  });
  const stateBeforeCe: GameState = {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    window: "main_step",
  };
  // C12 effects[2] (continuous, offer_magic_pre_cost_trigger) を発揮し CE を登録する
  // (実ゲームでは場に置かれた時点で発揮済みの状態を模す。p2-05-mid-battle-join.test.ts と同型)。
  const state = executeEffect({
    chainId: "test:engine-magic-field-pre-cost-payment-trigger:295",
    state: stateBeforeCe,
    effect: C12_CONTINUOUS_TRIGGER_EFFECT,
    sourceInstanceId: "c12-1",
    actingPlayerId: ALICE,
    getCardDefinitionById,
  });
  return { state, c12Id: "c12-1" };
}

function findUseMagicAction(state: GameState, sourceInstanceId: string) {
  const actions = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById,
    getRegisteredMagicActions: magicLookup,
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredBurstActions: () => undefined,
  });
  const action = actions.find(
    (a) => a.kind === "use_magic" && a.sourceInstanceId === sourceInstanceId
  );
  expect(action).toBeDefined();
  return action!;
}

function withAliceFlashWindow(state: GameState): GameState {
  return {
    ...state,
    step: "attack",
    window: "flash_before_block",
    activeAttack: {
      attackId: "attack-group:pre-cost:alice:battle-entity:none",
      primaryEntityId: "battle-entity:none",
      participantEntityIds: [],
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [],
      symbolResolutionOrder: [],
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
  };
}

function withAliceStackResponseWindow(state: GameState): GameState {
  return {
    ...state,
    window: "stack",
    stackWindow: {
      priorityPlayerId: ALICE,
      consecutivePassCount: 0,
      actingPlayerId: BOB,
      previousWindow: "main_step",
      stackResponseSourcePlayerId: BOB,
      subStackEverOpened: false,
      burstWindowKind: null,
      pendingStackAction: {
        stackId: "stack:parent-bob",
        actionKind: "magic",
        chainId: "magic:parent-bob",
        actingPlayerId: BOB,
        cardInstanceId: "opponent-stack-magic-1",
        cardDefinitionId: OPPONENT_STACK_MAGIC.cardNo,
        targetInstanceIds: [],
        targetEffectFilterTags: [],
        previousResponseSourcePlayerId: null,
        previousPendingStackAction: null,
        isNullified: false,
      },
    },
  };
}

function withAliceBattleFlashStackResponseWindow(state: GameState): GameState {
  const flashState = withAliceFlashWindow(state);
  const activeAttack = flashState.activeAttack!;
  const flashWindowState = activeAttack.flashWindowState!;
  return {
    ...flashState,
    activeAttack: {
      ...activeAttack,
      flashWindowState: {
        ...flashWindowState,
        // Bob のフラッシュ・スタックへ Alice がスタックマジックで応答する状態。
        // C12 はこの親を解決せず、その上で先に自身を解決しなければならない。
        priorityPlayerId: ALICE,
        stackResponseSourcePlayerId: BOB,
        pendingStackAction: {
          stackId: "stack:flash-parent-bob",
          actionKind: "magic",
          chainId: "magic:flash-parent-bob",
          actingPlayerId: BOB,
          cardInstanceId: "opponent-stack-magic-1",
          cardDefinitionId: OPPONENT_STACK_MAGIC.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
          isNullified: false,
        },
      },
    },
  };
}

function getPendingMagicInstanceId(state: GameState): string | undefined {
  return (
    state.stackWindow?.pendingStackAction?.cardInstanceId ??
    state.activeAttack?.flashWindowState?.pendingStackAction?.cardInstanceId
  );
}

/** マジック使用宣言後に開くスタック窓を、相手の pass で閉じ通常解決 (in_use→trash) まで進める。 */
function chooseC12Count(state: GameState): GameState {
  const pending = state.pendingCountSelection;
  if (!pending) return state;
  const action = getLegalActions({
    state,
    actingPlayerId: pending.actingPlayerId,
    getCardDefinitionById,
  }).find((candidate) => candidate.kind === "resolve_pending_count_decrease")!;
  expect(pending.selectionAction?.kind).toBe("move_card");
  return applyLegalAction({
    state,
    action,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredMagicActions: magicLookup,
    countDecreaseSelection: pending.max,
  }).state;
}

function closeStackWindowIfOpen(state: GameState): GameState {
  if (state.window !== "stack" || !state.stackWindow) return state;
  const opponentId = state.stackWindow.priorityPlayerId;
  const after = applyLegalAction({
    state,
    action: {
      kind: "pass_stack",
      actionId: `pass:${opponentId}`,
      can: true,
      reason: "test_close_stack",
      actingPlayerId: opponentId,
    },
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => undefined,
    getRegisteredMagicActions: magicLookup,
  }).state;
  return chooseC12Count(after);
}

function passBattleFlashStack(state: GameState): GameState {
  const actingPlayerId = state.activeAttack?.flashWindowState?.priorityPlayerId;
  if (!actingPlayerId) {
    throw new Error("Expected an open battle flash stack window");
  }
  const action = getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById,
    getRegisteredMagicActions: magicLookup,
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredBurstActions: () => undefined,
  }).find((candidate) => candidate.kind === "pass_battle_flash");
  if (!action || action.kind !== "pass_battle_flash") {
    throw new Error("Expected a pass_battle_flash action");
  }
  const after = applyLegalAction({
    state,
    action,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => undefined,
    getRegisteredMagicActions: magicLookup,
  }).state;
  return chooseC12Count(after);
}

function declareFieldMagicPreCostUse(state: GameState): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById,
    getRegisteredMagicActions: magicLookup,
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredBurstActions: () => undefined,
  }).find(
    (candidate) => candidate.kind === "resolve_field_magic_pre_cost_trigger"
  );
  if (
    !action ||
    action.kind !== "resolve_field_magic_pre_cost_trigger" ||
    !action.triggerMagicUse
  ) {
    throw new Error("Expected a payable field magic pre-cost trigger action");
  }
  return applyLegalAction({
    state,
    action,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => undefined,
    getRegisteredMagicActions: magicLookup,
    fieldMagicPreCostTriggerDecision: "trigger",
    paymentSources:
      action.triggerMagicUse.finalCost === 0
        ? []
        : [{ kind: "reserve", amount: action.triggerMagicUse.finalCost }],
  }).state;
}

function resolveFieldMagicPreCostUse(state: GameState): GameState {
  return closeStackWindowIfOpen(declareFieldMagicPreCostUse(state));
}

function resumeInterruptedMagicUse(
  state: GameState,
  sourceInstanceId: string
): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById,
    getRegisteredMagicActions: magicLookup,
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredBurstActions: () => undefined,
  }).find(
    (candidate) =>
      candidate.kind === "use_magic" &&
      candidate.sourceInstanceId === sourceInstanceId
  );
  if (!action || action.kind !== "use_magic") {
    throw new Error("Expected the interrupted magic use to be reoffered");
  }
  return applyLegalAction({
    state,
    action,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => undefined,
    getRegisteredMagicActions: magicLookup,
    paymentSources:
      action.finalCost === 0
        ? []
        : [{ kind: "reserve", amount: action.finalCost }],
  }).state;
}

describe("engine-magic-field-pre-cost-payment-trigger: offer_magic_pre_cost_trigger CE registration", () => {
  it("effect 定義: continuous + offer_magic_pre_cost_trigger(tribeFilter:[地球], triggerEffectIndex:1)", () => {
    expect(C12_CONTINUOUS_TRIGGER_EFFECT.stub).toBeUndefined();
    const action = C12_CONTINUOUS_TRIGGER_EFFECT.steps[0]!.action;
    expect(action.kind).toBe("offer_magic_pre_cost_trigger");
    if (action.kind !== "offer_magic_pre_cost_trigger") throw new Error("x");
    expect(action.tribeFilter).toEqual(["地球"]);
    expect(action.triggerEffectIndex).toBe(1);
  });

  it("CE 発揮後、activeContinuousEffects に modifierTag:offer_magic_pre_cost_trigger が登録される", () => {
    const { state } = buildState();
    const ce = state.activeContinuousEffects.find(
      (c) => c.modifierTag === "offer_magic_pre_cost_trigger"
    );
    expect(ce).toBeDefined();
    expect(ce!.targetInstanceId).toBe(ALICE);
    expect(ce!.metadata?.["triggerEffectIndex"]).toBe(1);
  });
});

describe("engine-magic-field-pre-cost-payment-trigger: use_magic 宣言のコスト支払い割り込み", () => {
  it("フラッシュ地球マジックでも、C12 の main 効果を支払い・応答窓付きで先に使用できる", () => {
    const { state } = buildState();
    const flashState = withAliceFlashWindow(state);
    const useAction = findUseMagicAction(flashState, "flash-earth-magic-1");
    expect(useAction.timing).toBe("flash");

    const intercepted = applyLegalAction({
      state: flashState,
      action: useAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      paymentSources: [{ kind: "reserve", amount: useAction.finalCost }],
    }).state;
    const triggerAction = getLegalActions({
      state: intercepted,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).find(
      (action) =>
        action.kind === "resolve_field_magic_pre_cost_trigger" &&
        action.triggerMagicUse !== undefined
    );
    expect(triggerAction).toMatchObject({
      triggerMagicUse: {
        sourceInstanceId: "c12-1",
        timing: "main",
      },
    });
    if (
      !triggerAction ||
      triggerAction.kind !== "resolve_field_magic_pre_cost_trigger" ||
      !triggerAction.triggerMagicUse
    ) {
      throw new Error("Expected payable C12 trigger action in flash window");
    }
    const c12Declared = applyLegalAction({
      state: intercepted,
      action: triggerAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      fieldMagicPreCostTriggerDecision: "trigger",
      paymentSources: [
        { kind: "reserve", amount: triggerAction.triggerMagicUse.finalCost },
      ],
    }).state;
    expect(
      c12Declared.cardInstances.find((card) => card.instanceId === "c12-1")
        ?.zone
    ).toBe("in_use");
    expect(getPendingMagicInstanceId(c12Declared)).toBe("c12-1");
  });

  it("親なし battle flash でも C12 後に元 flash を再提示し、相手の応答窓を経て解決する", () => {
    const { state } = buildState();
    const flashState = withAliceFlashWindow(state);
    const originalAction = findUseMagicAction(
      flashState,
      "flash-earth-magic-1"
    );
    expect(originalAction).toMatchObject({ timing: "flash" });

    const intercepted = applyLegalAction({
      state: flashState,
      action: originalAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      paymentSources: [{ kind: "reserve", amount: originalAction.finalCost }],
    }).state;
    const c12Declared = declareFieldMagicPreCostUse(intercepted);
    expect(
      c12Declared.activeAttack?.flashWindowState?.pendingStackAction
    ).toMatchObject({ cardInstanceId: "c12-1" });

    // 親 stack のない flash 本体でも、C12 を解決して internal pending を残す。
    const afterC12Pass = passBattleFlashStack(c12Declared);
    expect(
      afterC12Pass.activeAttack?.flashWindowState?.pendingStackAction
    ).toBeNull();
    expect(afterC12Pass.pendingCoreDistribution).not.toBeNull();
    expect(afterC12Pass.pendingFieldMagicPreCostTrigger?.triggered).toBe(true);

    const pending = afterC12Pass.pendingCoreDistribution!;
    const distributionAction = getLegalActions({
      state: afterC12Pass,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((action) => action.kind === "resolve_pending_core_distribution")!;
    const afterDistribution = applyLegalAction({
      state: afterC12Pass,
      action: distributionAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      coreDistributionAllocations: Object.fromEntries(
        pending.candidates.map((candidate) => [candidate.instanceId, 1])
      ),
      coreDistributionSourceAllocations: {
        reserve: pending.candidates.length,
      },
    }).state;

    // 親なしの場合は response source も Alice に戻し、元の flash timing を再提示する。
    const reoffered = findUseMagicAction(
      afterDistribution,
      "flash-earth-magic-1"
    );
    expect(reoffered).toMatchObject({ timing: "flash" });
    const originalDeclared = applyLegalAction({
      state: afterDistribution,
      action: reoffered,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      paymentSources:
        reoffered.finalCost === 0
          ? []
          : [{ kind: "reserve", amount: reoffered.finalCost }],
    }).state;
    expect(
      originalDeclared.activeAttack?.flashWindowState?.pendingStackAction
    ).toMatchObject({ cardInstanceId: "flash-earth-magic-1" });

    // Bob の stack 応答候補を確認した上で pass。元 flash は C12 の結果を保持したまま
    // 共通 stack 解決を通ってトラッシュへ移る。
    expect(
      getLegalActions({
        state: originalDeclared,
        actingPlayerId: BOB,
        getCardDefinitionById,
        getRegisteredMagicActions: magicLookup,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredBurstActions: () => undefined,
      }).find(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === "opponent-stack-magic-1" &&
          action.timing === "stack"
      )
    ).toBeDefined();
    const afterOriginalPass = passBattleFlashStack(originalDeclared);
    expect(
      afterOriginalPass.cardInstances.find(
        (card) => card.instanceId === "flash-earth-magic-1"
      )?.zone
    ).toBe("trash");
    expect(
      afterOriginalPass.activeAttack?.flashWindowState?.pendingStackAction
    ).toBeNull();
  });

  it("スタック地球マジックでも、C12 は親スタックへネストして通常使用される", () => {
    const { state } = buildState();
    const stackState = withAliceStackResponseWindow(state);
    const useAction = findUseMagicAction(stackState, "stack-earth-magic-1");
    expect(useAction.timing).toBe("stack");
    const intercepted = applyLegalAction({
      state: stackState,
      action: useAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      paymentSources: [{ kind: "reserve", amount: useAction.finalCost }],
    }).state;
    const triggerAction = getLegalActions({
      state: intercepted,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).find(
      (action) =>
        action.kind === "resolve_field_magic_pre_cost_trigger" &&
        action.triggerMagicUse !== undefined
    );
    if (
      !triggerAction ||
      triggerAction.kind !== "resolve_field_magic_pre_cost_trigger" ||
      !triggerAction.triggerMagicUse
    ) {
      throw new Error("Expected payable C12 trigger action in stack window");
    }
    const c12Declared = applyLegalAction({
      state: intercepted,
      action: triggerAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      fieldMagicPreCostTriggerDecision: "trigger",
      paymentSources: [
        { kind: "reserve", amount: triggerAction.triggerMagicUse.finalCost },
      ],
    }).state;
    expect(
      c12Declared.cardInstances.find((card) => card.instanceId === "c12-1")
        ?.zone
    ).toBe("in_use");
    expect(c12Declared.stackWindow?.pendingStackAction).toMatchObject({
      cardInstanceId: "c12-1",
      previousPendingStackAction: {
        cardInstanceId: "opponent-stack-magic-1",
      },
    });
  });

  it("通常スタックの親は C12 解決中に保持し、元スタックマジックを先に応答可能にする", () => {
    const { state } = buildState();
    const stackState = withAliceStackResponseWindow(state);
    const originalAction = findUseMagicAction(
      stackState,
      "stack-earth-magic-1"
    );
    expect(originalAction).toMatchObject({ timing: "stack" });

    const intercepted = applyLegalAction({
      state: stackState,
      action: originalAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      paymentSources: [{ kind: "reserve", amount: originalAction.finalCost }],
    }).state;
    const c12Declared = declareFieldMagicPreCostUse(intercepted);
    expect(c12Declared.stackWindow?.pendingStackAction).toMatchObject({
      cardInstanceId: "c12-1",
      previousPendingStackAction: {
        cardInstanceId: "opponent-stack-magic-1",
      },
    });

    // C12 の pass は C12 自身だけを peel し、Bob の親応答を残したまま C12 の
    // core_distribute を処理する。ここで親を cascade すると元使用が失効する。
    const afterC12Pass = closeStackWindowIfOpen(c12Declared);
    expect(afterC12Pass.window).toBe("stack");
    expect(afterC12Pass.stackWindow?.pendingStackAction).toMatchObject({
      cardInstanceId: "opponent-stack-magic-1",
    });
    expect(afterC12Pass.pendingCoreDistribution).not.toBeNull();
    expect(afterC12Pass.pendingFieldMagicPreCostTrigger?.triggered).toBe(true);

    const pending = afterC12Pass.pendingCoreDistribution!;
    const distributionAction = getLegalActions({
      state: afterC12Pass,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((action) => action.kind === "resolve_pending_core_distribution")!;
    const afterDistribution = applyLegalAction({
      state: afterC12Pass,
      action: distributionAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      coreDistributionAllocations: Object.fromEntries(
        pending.candidates.map((candidate) => [candidate.instanceId, 1])
      ),
      coreDistributionSourceAllocations: {
        reserve: pending.candidates.length,
      },
    }).state;

    // 03a の C12 → 支払い再開 → 元マジック応答の順: 親はまだ残り、Alice は
    // 元スタックマジックをその上へ再提示でき、Bob はその元マジックへ応答できる。
    expect(afterDistribution.stackWindow?.pendingStackAction).toMatchObject({
      cardInstanceId: "opponent-stack-magic-1",
    });
    const reoffered = findUseMagicAction(
      afterDistribution,
      "stack-earth-magic-1"
    );
    expect(reoffered).toMatchObject({ timing: "stack" });
    const originalDeclared = applyLegalAction({
      state: afterDistribution,
      action: reoffered,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      paymentSources:
        reoffered.finalCost === 0
          ? []
          : [{ kind: "reserve", amount: reoffered.finalCost }],
    }).state;
    expect(originalDeclared.stackWindow?.pendingStackAction).toMatchObject({
      cardInstanceId: "stack-earth-magic-1",
      previousPendingStackAction: {
        cardInstanceId: "opponent-stack-magic-1",
      },
    });
    expect(
      getLegalActions({
        state: originalDeclared,
        actingPlayerId: BOB,
        getCardDefinitionById,
        getRegisteredMagicActions: magicLookup,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredBurstActions: () => undefined,
      }).find(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === "opponent-stack-magic-1" &&
          action.timing === "stack"
      )
    ).toBeDefined();
  });

  it("battle flash の親スタックは C12 解決中に保持し、core_distribute 後の元スタックマジックへ応答できる", () => {
    const { state } = buildState();
    const battleStackState = withAliceBattleFlashStackResponseWindow(state);
    const originalAction = findUseMagicAction(
      battleStackState,
      "stack-earth-magic-1"
    );
    expect(originalAction).toMatchObject({ timing: "stack" });

    const intercepted = applyLegalAction({
      state: battleStackState,
      action: originalAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      paymentSources: [{ kind: "reserve", amount: originalAction.finalCost }],
    }).state;
    const c12Declared = declareFieldMagicPreCostUse(intercepted);
    expect(
      c12Declared.activeAttack?.flashWindowState?.pendingStackAction
    ).toMatchObject({
      cardInstanceId: "c12-1",
      previousPendingStackAction: {
        cardInstanceId: "opponent-stack-magic-1",
      },
    });

    // C12 の pass は C12 自身だけを peel し、Bob の親応答を残す。
    const afterC12Pass = passBattleFlashStack(c12Declared);
    expect(
      afterC12Pass.activeAttack?.flashWindowState?.pendingStackAction
    ).toMatchObject({ cardInstanceId: "opponent-stack-magic-1" });
    expect(afterC12Pass.pendingCoreDistribution).not.toBeNull();
    expect(afterC12Pass.pendingFieldMagicPreCostTrigger?.triggered).toBe(true);

    const pending = afterC12Pass.pendingCoreDistribution!;
    const distributionAction = getLegalActions({
      state: afterC12Pass,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((action) => action.kind === "resolve_pending_core_distribution")!;
    const afterDistribution = applyLegalAction({
      state: afterC12Pass,
      action: distributionAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      coreDistributionAllocations: Object.fromEntries(
        pending.candidates.map((candidate) => [candidate.instanceId, 1])
      ),
      coreDistributionSourceAllocations: {
        reserve: pending.candidates.length,
      },
    }).state;

    // 中断元は同じ親の上へ再提示され、Bob は元スタックマジックに応答できる。
    expect(
      afterDistribution.activeAttack?.flashWindowState?.pendingStackAction
    ).toMatchObject({ cardInstanceId: "opponent-stack-magic-1" });
    const reoffered = findUseMagicAction(
      afterDistribution,
      "stack-earth-magic-1"
    );
    expect(reoffered).toMatchObject({ timing: "stack" });
    const originalDeclared = applyLegalAction({
      state: afterDistribution,
      action: reoffered,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      paymentSources:
        reoffered.finalCost === 0
          ? []
          : [{ kind: "reserve", amount: reoffered.finalCost }],
    }).state;
    expect(
      originalDeclared.activeAttack?.flashWindowState?.pendingStackAction
    ).toMatchObject({
      cardInstanceId: "stack-earth-magic-1",
      previousPendingStackAction: {
        cardInstanceId: "opponent-stack-magic-1",
      },
    });
    expect(
      getLegalActions({
        state: originalDeclared,
        actingPlayerId: BOB,
        getCardDefinitionById,
        getRegisteredMagicActions: magicLookup,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredBurstActions: () => undefined,
      }).find(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === "opponent-stack-magic-1" &&
          action.timing === "stack"
      )
    ).toBeDefined();
  });

  it("C12 自身を支払えないときは trigger なしの decline 専用 action だけを提示する", () => {
    const { state } = buildState();
    const noReserveState: GameState = {
      ...state,
      players: state.players.map((player) =>
        player.id === ALICE ? { ...player, reserveNormalCoreCount: 0 } : player
      ),
    };
    const useAction = findUseMagicAction(
      noReserveState,
      "fully-reduced-earth-magic-1"
    );
    expect(useAction.finalCost).toBe(0);
    const intercepted = applyLegalAction({
      state: noReserveState,
      action: useAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      paymentSources: [],
    }).state;
    const pendingAction = getLegalActions({
      state: intercepted,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).find((action) => action.kind === "resolve_field_magic_pre_cost_trigger");
    expect(pendingAction).toBeDefined();
    expect(pendingAction).not.toHaveProperty("triggerMagicUse");
  });

  it("training の二段階 core_distribute を完走して中断マジックを再開する", () => {
    const { state } = buildState();
    const useAction = findUseMagicAction(state, "earth-magic-1");
    const intercepted = applyLegalAction({
      state,
      action: useAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      paymentSources: [{ kind: "reserve", amount: 2 }],
    }).state;
    const declaredTrigger = declareFieldMagicPreCostUse(intercepted);
    expect(declaredTrigger.window).toBe("stack");
    expect(
      getLegalActions({
        state: declaredTrigger,
        actingPlayerId: BOB,
        getCardDefinitionById,
        getRegisteredMagicActions: magicLookup,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredBurstActions: () => undefined,
      }).find(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === "opponent-stack-magic-1"
      )
    ).toMatchObject({
      kind: "use_magic",
      timing: "stack",
      sourceInstanceId: "opponent-stack-magic-1",
    });
    const afterTrigger = closeStackWindowIfOpen(declaredTrigger);
    const targetTotalsAction = getLegalActions({
      state: afterTrigger,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;
    const targetTotalsNode = createActionInputDecisionNode(
      afterTrigger,
      targetTotalsAction,
      { maxGeneratedChoices: 1024 }
    );
    expect(targetTotalsNode?.choices).not.toHaveLength(0);

    const afterTargetTotals = applyTrainingDecisionChoice(
      afterTrigger,
      targetTotalsNode!,
      targetTotalsNode!.choices[0]!,
      trainingEngine
    );
    const sourceAllocationAction = getLegalActions({
      state: afterTargetTotals,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;
    const sourceAllocationNode = createActionInputDecisionNode(
      afterTargetTotals,
      sourceAllocationAction,
      { maxGeneratedChoices: 1024 }
    );
    expect(sourceAllocationNode?.choices).not.toHaveLength(0);

    const resolved = applyTrainingDecisionChoice(
      afterTargetTotals,
      sourceAllocationNode!,
      sourceAllocationNode!.choices[0]!,
      trainingEngine
    );
    expect(resolved.pendingCoreDistribution).toBeNull();
    expect(resolved.pendingFieldMagicPreCostTrigger?.triggered).toBe(true);
    const resumed = resumeInterruptedMagicUse(resolved, "earth-magic-1");
    expect(resumed.pendingFieldMagicPreCostTrigger).toBeNull();
  });

  it("系統「地球」のマジック使用宣言はコスト支払い前に中断され pending が立つ (コアは未消費)", () => {
    const { state } = buildState();
    const useAction = findUseMagicAction(state, "earth-magic-1");
    expect(useAction.preCostTriggerOffer).toMatchObject({
      sourceInstanceId: "c12-1",
      sourceDefinitionId: C12_CARD.cardNo,
      effectIndex: 1,
    });
    const result = applyLegalAction({
      state,
      action: useAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      paymentSources: [{ kind: "reserve", amount: 2 }],
    });
    expect(result.state.pendingFieldMagicPreCostTrigger).not.toBeNull();
    expect(
      result.state.pendingFieldMagicPreCostTrigger?.triggerSourceInstanceId
    ).toBe("c12-1");
    expect(
      result.state.pendingFieldMagicPreCostTrigger?.interruptedMagicUse.action
    ).toMatchObject({ kind: "use_magic", sourceInstanceId: "earth-magic-1" });
    // コストはまだ支払われていない
    expect(
      result.state.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(10);
    // カードもまだ手札のまま
    expect(
      result.state.cardInstances.find((c) => c.instanceId === "earth-magic-1")
        ?.zone
    ).toBe("hand");
  });

  it("系統が「地球」でないマジックは割り込みの対象外 (即座に通常のコスト支払いへ進む)", () => {
    const { state } = buildState();
    const useAction = findUseMagicAction(state, "non-earth-magic-1");
    const result = applyLegalAction({
      state,
      action: useAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      paymentSources: [{ kind: "reserve", amount: 2 }],
    });
    expect(result.state.pendingFieldMagicPreCostTrigger).toBeNull();
  });

  it("decline: 中断していたマジック使用をそのまま再開しコストを支払う (メイン効果は発揮しない)", () => {
    const { state } = buildState();
    const useAction = findUseMagicAction(state, "earth-magic-1");
    const intercepted = applyLegalAction({
      state,
      action: useAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      paymentSources: [{ kind: "reserve", amount: 2 }],
    }).state;

    const declineActions = getLegalActions({
      state: intercepted,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(declineActions).toHaveLength(1);
    const declineAction = declineActions.find(
      (a) => a.kind === "resolve_field_magic_pre_cost_trigger"
    )!;
    expect(declineAction).toBeDefined();

    const result = applyLegalAction({
      state: intercepted,
      action: declineAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      fieldMagicPreCostTriggerDecision: "decline",
    });

    expect(result.state.pendingFieldMagicPreCostTrigger).toBeNull();
    // コストが支払われた (reserve 2 消費)
    expect(
      result.state.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(8);
    // マジックカードは使用済み (スタック窓を閉じて通常解決 → トラッシュへ)
    const closed = closeStackWindowIfOpen(result.state);
    expect(
      closed.cardInstances.find((c) => c.instanceId === "earth-magic-1")?.zone
    ).toBe("trash");
    // メイン効果 (デッキ由来分身スピリット) は発揮されていない
    expect(
      result.state.cardInstances.filter(
        (c) => c.zone === "field" && c.definitionId === DECK_FILLER.cardNo
      )
    ).toHaveLength(0);
  });

  it("decline は usageLimit を消費しない: 直後に別の地球マジックを使用しても再度 offer される", () => {
    const { state } = buildState();
    const useAction1 = findUseMagicAction(state, "earth-magic-1");
    const intercepted1 = applyLegalAction({
      state,
      action: useAction1,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      paymentSources: [{ kind: "reserve", amount: 2 }],
    }).state;
    const declineAction1 = getLegalActions({
      state: intercepted1,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_field_magic_pre_cost_trigger")!;
    const afterDecline1 = closeStackWindowIfOpen(
      applyLegalAction({
        state: intercepted1,
        action: declineAction1,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => undefined,
        getRegisteredMagicActions: magicLookup,
        fieldMagicPreCostTriggerDecision: "decline",
      }).state
    );

    // 2枚目の地球マジックを使用: 1枚目は decline しただけなので usageLimit は未消費のまま。
    // 再度 pendingFieldMagicPreCostTrigger が立つ (提示される) はずである。
    const useAction2 = findUseMagicAction(afterDecline1, "earth-magic-2");
    const intercepted2 = applyLegalAction({
      state: afterDecline1,
      action: useAction2,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      paymentSources: [{ kind: "reserve", amount: 2 }],
    });
    expect(intercepted2.state.pendingFieldMagicPreCostTrigger).not.toBeNull();
    expect(
      intercepted2.state.pendingFieldMagicPreCostTrigger?.interruptedMagicUse
        .action
    ).toMatchObject({ kind: "use_magic", sourceInstanceId: "earth-magic-2" });
  });

  it("trigger: 戦力投入を支払い・応答窓付きで解決後、元マジックの支払いを再提示する", () => {
    const { state } = buildState();
    const useAction = findUseMagicAction(state, "earth-magic-1");
    const intercepted = applyLegalAction({
      state,
      action: useAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      paymentSources: [{ kind: "reserve", amount: 2 }],
    }).state;

    const afterTrigger = resolveFieldMagicPreCostUse(intercepted);

    // メイン効果が発揮され、デッキ由来分身スピリットが裏向きで場に置かれる
    const placed = afterTrigger.cardInstances.filter(
      (c) => c.zone === "field" && c.definitionId === DECK_FILLER.cardNo
    );
    expect(placed).toHaveLength(3);
    // コア配分待ちで中断中 (まだコスト支払いへは戻っていない)
    expect(afterTrigger.pendingCoreDistribution).not.toBeNull();
    expect(afterTrigger.pendingFieldMagicPreCostTrigger?.triggered).toBe(true);
    expect(
      afterTrigger.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(7);

    // コア配分を解決する (候補全員へ1コアずつ)
    const pending = afterTrigger.pendingCoreDistribution!;
    const allocations: Record<string, number> = {};
    for (const c of pending.candidates) allocations[c.instanceId] = 1;
    const cdAction = getLegalActions({
      state: afterTrigger,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;
    const resolved = applyLegalAction({
      state: afterTrigger,
      action: cdAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      coreDistributionAllocations: allocations,
      coreDistributionSourceAllocations: { reserve: pending.candidates.length },
    }).state;

    // C12 の支払い・応答・効果が完了してから、元マジックが新しい支払い action として戻る。
    expect(resolved.pendingFieldMagicPreCostTrigger?.triggered).toBe(true);
    const resumed = resumeInterruptedMagicUse(resolved, "earth-magic-1");
    expect(resumed.pendingFieldMagicPreCostTrigger).toBeNull();
    const closed = closeStackWindowIfOpen(resumed);
    expect(
      closed.cardInstances.find((c) => c.instanceId === "earth-magic-1")?.zone
    ).toBe("trash");
    // 場のC12自身1枚で自己軽減し、使用コスト3、配分3、元マジック1を順に支払う。
    expect(
      resumed.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(3);
  });

  it.each([6, 7])(
    "C12自己軽減後の再支払い境界: 初期リザーブ%i（6なら不足・7なら場コア込みで支払える）",
    (startingReserve) => {
      const { state } = buildState();
      const sparseState: GameState = {
        ...state,
        players: state.players.map((player) =>
          player.id === ALICE
            ? { ...player, reserveNormalCoreCount: startingReserve }
            : player
        ),
      };
      const useAction = findUseMagicAction(
        sparseState,
        "unpayable-earth-magic-1"
      );
      const intercepted = applyLegalAction({
        state: sparseState,
        action: useAction,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => undefined,
        getRegisteredMagicActions: magicLookup,
      }).state;
      const afterTrigger = resolveFieldMagicPreCostUse(intercepted);
      const pending = afterTrigger.pendingCoreDistribution!;
      const allocations: Record<string, number> = {};
      for (const card of pending.candidates) allocations[card.instanceId] = 1;
      const distributionAction = getLegalActions({
        state: afterTrigger,
        actingPlayerId: ALICE,
        getCardDefinitionById,
      }).find((action) => action.kind === "resolve_pending_core_distribution")!;

      const resolved = applyLegalAction({
        state: afterTrigger,
        action: distributionAction,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => undefined,
        getRegisteredMagicActions: magicLookup,
        coreDistributionAllocations: allocations,
        coreDistributionSourceAllocations: {
          reserve: pending.candidates.length,
        },
      }).state;

      const availableCores =
        resolved.players.find((player) => player.id === ALICE)!
          .reserveNormalCoreCount +
        pending.candidates.reduce(
          (sum, candidate) =>
            sum +
            (resolved.cardInstances.find(
              (card) => card.instanceId === candidate.instanceId
            )?.normalCoreCount ?? 0),
          0
        );
      expect(availableCores).toBe(startingReserve - 3);
      if (startingReserve === 7) {
        expect(resolved.pendingFieldMagicPreCostTrigger?.triggered).toBe(true);
        const resumedAction = findUseMagicAction(
          resolved,
          "unpayable-earth-magic-1"
        );
        expect(resumedAction.finalCost).toBe(4);
        const paid = applyLegalAction({
          state: resolved,
          action: resumedAction,
          getCardDefinitionById,
          getRegisteredTriggeredEffectActions: () => [],
          getRegisteredBurstActions: () => undefined,
          getRegisteredMagicActions: magicLookup,
          paymentSources: [
            { kind: "reserve", amount: 1 },
            ...pending.candidates.map((candidate) => ({
              kind: "card" as const,
              instanceId: candidate.instanceId,
              amount: 1,
            })),
          ],
        }).state;
        const closed = closeStackWindowIfOpen(paid);
        expect(closed.pendingFieldMagicPreCostTrigger).toBeNull();
        expect(
          closed.cardInstances.find(
            (card) => card.instanceId === "unpayable-earth-magic-1"
          )?.zone
        ).toBe("trash");
        expect(
          closed.players.find((player) => player.id === ALICE)!
            .reserveNormalCoreCount
        ).toBe(0);
        expect(
          closed.players.find((player) => player.id === ALICE)!
            .trashNormalCoreCount
        ).toBe(7);
        return;
      }

      expect(resolved.pendingFieldMagicPreCostTrigger).toBeNull();
      expect(resolved.window).toBe("main_step");
      expect(
        resolved.cardInstances.find(
          (card) => card.instanceId === "unpayable-earth-magic-1"
        )?.zone
      ).toBe("hand");
      expect(
        resolved.players.find((player) => player.id === ALICE)
          ?.reserveNormalCoreCount
      ).toBe(0);
      expect(resolved.log).toContain(
        "magic:pre-cost-trigger:unpayable:return-to-origin:unpayable-earth-magic-1"
      );
    }
  );

  it("保存済み入力がなくても、C12後に0コストの元マジックを共通actionで再開できる", () => {
    const { state } = buildState();
    const zeroCostAction = findUseMagicAction(
      state,
      "fully-reduced-earth-magic-1"
    );
    expect(zeroCostAction).toMatchObject({ finalCost: 0 });
    const intercepted = applyLegalAction({
      state,
      action: zeroCostAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
    }).state;
    const afterTrigger = resolveFieldMagicPreCostUse(intercepted);
    const pending = afterTrigger.pendingCoreDistribution!;
    const distributionAction = getLegalActions({
      state: afterTrigger,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((action) => action.kind === "resolve_pending_core_distribution")!;

    const resolved = applyLegalAction({
      state: afterTrigger,
      action: distributionAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      coreDistributionAllocations: { [pending.candidates[0]!.instanceId]: 1 },
      coreDistributionSourceAllocations: { reserve: 1 },
    }).state;

    expect(resolved.pendingCoreDistribution).toBeNull();
    expect(resolved.pendingFieldMagicPreCostTrigger?.triggered).toBe(true);
    const resumed = resumeInterruptedMagicUse(
      resolved,
      "fully-reduced-earth-magic-1"
    );
    expect(resumed.pendingFieldMagicPreCostTrigger).toBeNull();
    const closed = closeStackWindowIfOpen(resumed);
    expect(
      closed.cardInstances.find(
        (card) => card.instanceId === "fully-reduced-earth-magic-1"
      )?.zone
    ).toBe("trash");
  });

  it("BSTH07.8-XX01 型では旧リザーブ指定が失効しても、分身上の新しい支払い元を再選択できる", () => {
    const { state } = buildState();
    const oneCostOverride: ContinuousEffect = {
      effectId: "test-bsth07-8-xx01-override",
      sourceInstanceId: "bsth07-8-xx01-1",
      sourceDefinitionId: "BSTH07.8-XX01",
      actingPlayerId: BOB,
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "cost_override",
      modifierAmount: 1,
      targetFilter: { player: "opponent", category: ["magic"] },
    };
    const overrideState: GameState = {
      ...state,
      players: state.players.map((player) =>
        player.id === ALICE ? { ...player, reserveNormalCoreCount: 2 } : player
      ),
      activeContinuousEffects: [
        ...state.activeContinuousEffects,
        oneCostOverride,
      ],
    };
    const overrideAction = getLegalActions({
      state: overrideState,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === "earth-magic-1" &&
        action.costMode === "override"
    );
    expect(overrideAction).toMatchObject({ finalCost: 1, overrideCost: 1 });
    if (!overrideAction || overrideAction.kind !== "use_magic") {
      throw new Error("Expected a one-cost override use_magic action");
    }

    const intercepted = applyLegalAction({
      state: overrideState,
      action: overrideAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      paymentSources: [{ kind: "reserve", amount: 1 }],
    }).state;
    const afterTrigger = resolveFieldMagicPreCostUse(intercepted);
    const pending = afterTrigger.pendingCoreDistribution!;
    const distributionAction = getLegalActions({
      state: afterTrigger,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((action) => action.kind === "resolve_pending_core_distribution")!;

    const resolved = applyLegalAction({
      state: afterTrigger,
      action: distributionAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      coreDistributionAllocations: { [pending.candidates[0]!.instanceId]: 1 },
      coreDistributionSourceAllocations: { reserve: 1 },
    }).state;

    expect(resolved.pendingCoreDistribution).toBeNull();
    expect(resolved.pendingFieldMagicPreCostTrigger?.triggered).toBe(true);
    const resumedAction = getLegalActions({
      state: resolved,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === "earth-magic-1" &&
        action.costMode === "override"
    );
    expect(resumedAction).toBeDefined();
    if (!resumedAction || resumedAction.kind !== "use_magic") {
      throw new Error("Expected a reoffered override magic use");
    }
    expect(resumedAction.availableReserveCoreAmount).toBe(0);
    expect(resumedAction.availableOnBoardCoreSources).toHaveLength(1);
  });

  it("〔ターンに1回：同名〕: 一度 trigger したら同ターン中はもう一枚の地球マジック使用時に再度は提示されない", () => {
    const { state: baseState } = buildState();
    const state: GameState = {
      ...baseState,
      players: baseState.players.map((player) =>
        player.id === ALICE ? { ...player, reserveNormalCoreCount: 12 } : player
      ),
    };
    const useAction1 = findUseMagicAction(state, "earth-magic-1");
    const intercepted1 = applyLegalAction({
      state,
      action: useAction1,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      paymentSources: [{ kind: "reserve", amount: 2 }],
    }).state;
    const afterTrigger = resolveFieldMagicPreCostUse(intercepted1);
    const pending = afterTrigger.pendingCoreDistribution!;
    const allocations: Record<string, number> = {};
    for (const c of pending.candidates) allocations[c.instanceId] = 1;
    const cdAction = getLegalActions({
      state: afterTrigger,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;
    const afterFirstUse = applyLegalAction({
      state: afterTrigger,
      action: cdAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      coreDistributionAllocations: allocations,
      coreDistributionSourceAllocations: { reserve: pending.candidates.length },
    }).state;

    // 1枚目の元マジックを再提示・解決してから2枚目を宣言する。
    const afterFirstUseClosed = closeStackWindowIfOpen(
      resumeInterruptedMagicUse(afterFirstUse, "earth-magic-1")
    );

    // 2枚目の地球マジックを使用: usageLimit (per_card_name/turn) 消費済みのため即座にコスト支払いへ
    const useAction2 = findUseMagicAction(afterFirstUseClosed, "earth-magic-2");
    const result2 = applyLegalAction({
      state: afterFirstUseClosed,
      action: useAction2,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
      paymentSources: [{ kind: "reserve", amount: 1 }],
    });
    expect(result2.state.pendingFieldMagicPreCostTrigger).toBeNull();
    const closed2 = closeStackWindowIfOpen(result2.state);
    expect(
      closed2.cardInstances.find((c) => c.instanceId === "earth-magic-2")?.zone
    ).toBe("trash");
  });
});
