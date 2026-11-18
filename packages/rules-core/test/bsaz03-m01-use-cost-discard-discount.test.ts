/**
 * BSAZ03-M01「雨の断章」effects[1b]:
 * 「このカードを使用するとき…手札を5枚まで破棄できる。破棄した枚数1につき、
 * このカードのコストを-1する。破棄したカードの効果は発揮されない。」
 *
 * BSAZ02.ts:774-779 の return_to_deck_top_bottom (固定2枚・trash由来) と同じ
 * useCostPayment + zone_discount 経路を、可変枚数 (0〜maxCount)・hand由来の
 * 新規 kind:"discard_hand" で拡張した legal action 生成 (costMode:
 * "zone_discount_variable") と適用 (getZoneCostPaymentForMagic /
 * applyMagicZoneCostPayment) を検証する。実際の card-data 定義自体の検証は
 * bsaz03-m01-cost-reduction-symbol.test.ts を参照。
 *
 * 実カード (BSAZ03-M01) は reductionSymbols の軽減計算が絡み検証が複雑になるため、
 * ここでは同型の cost_modify + useCostPayment(discard_hand) を持つ専用テストカードで
 * 挙動を単離検証する (BSAZ02 テストの lowCostMagic 手法と同型)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  applyTrainingDecisionChoice,
  buildMagicLookup,
  createCardInstance,
  createActionInputDecisionNode,
  createEmptyGameState,
  getLegalActions,
  getNextTrainingDecision,
  recomputeAndRebuildContinuousEffects,
} from "../src";
import type { CardDefinition, Engine, GameState, LegalAction } from "../src";

const ALICE = "alice";
const BOB = "bob";

const TEST_MAGIC: CardDefinition = {
  cardNo: "TEST-DISCARD-DISCOUNT-MAGIC",
  name: "テスト破棄割引マジック",
  printedCategory: "magic",
  colors: ["yellow"],
  cost: 5,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    // 使用時、手札を3枚まで破棄・破棄1枚につきコスト-1 (BSAZ03-M01 effects[1b] 同型)。
    {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "cost_modify",
            target: { kind: "self" },
            modifier: { additionalCostValue: -1 },
            useCostPayment: {
              kind: "discard_hand",
              sourceZone: "hand",
              maxCount: 3,
            },
          },
        },
      ],
      textRef: [0],
    },
    // use_magic legal action を生む本体 (BSAZ03-M01 effects[2] と同じく steps:[] で可)。
    {
      timing: { kind: "activated", mode: "main" },
      steps: [],
      textRef: [0],
    },
  ],
};

// moved_to_trash 自動効果 (mandatory・条件なし) を持つ破棄候補カード。
// discard_hand 払いが processMovedToTrashEffects を呼ばないことの検証に使う。
const TRIGGER_ON_TRASH: CardDefinition = {
  cardNo: "TEST-DISCARD-TRIGGER-ON-TRASH",
  name: "トラッシュ移動時手札に戻る",
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
  effects: [
    {
      timing: { kind: "card_event", event: "moved_to_trash" },
      cardEventDisposition: { kind: "move", destination: "hand" },
      steps: [{ action: { kind: "move_self", destination: "hand" } }],
      textRef: [0],
    },
  ],
};

const FILLER: CardDefinition = {
  cardNo: "TEST-DISCARD-FILLER",
  name: "テストフィラー",
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
  effects: [],
};

// The broad payment surface is intentionally made from spirits, rather than
// magic cards: BSAZ03-M01 itself gains yellow reductions from field magic and
// that unrelated continuous effect would otherwise make its printed cost zero
// before the variable discard payment is exercised.
const PAYMENT_SPIRIT: CardDefinition = {
  cardNo: "TEST-BSAZ03-M01-PAYMENT-SPIRIT",
  name: "テスト支払いスピリット",
  printedCategory: "spirit",
  colors: ["yellow"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const MAGIC_ADDITIONAL_COST_TAX: CardDefinition = {
  cardNo: "TEST-MAGIC-ADDITIONAL-COST-TAX",
  name: "テストマジック追加コスト",
  printedCategory: "nexus",
  colors: ["purple"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "cost_modify",
            player: "opponent",
            cardFilter: { category: ["magic"], usingEffectMode: ["main"] },
            modifier: { additionalCostValue: 3 },
            duration: { scope: "while_on_field" },
          },
        },
      ],
    },
  ],
};

const cardMap = new Map<string, CardDefinition>(
  [TEST_MAGIC, TRIGGER_ON_TRASH, FILLER, MAGIC_ADDITIONAL_COST_TAX].map((c) => [
    c.cardNo,
    c,
  ])
);
const getDef = (id: string) => cardMap.get(id);
const magicLookup = buildMagicLookup([TEST_MAGIC, TRIGGER_ON_TRASH, FILLER]);
const trainingEngine: Engine = {
  cards: [TEST_MAGIC, TRIGGER_ON_TRASH, FILLER, MAGIC_ADDITIONAL_COST_TAX],
  getCardDefinitionById: getDef,
  lookups: {
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => [],
    getRegisteredBattleImmediateEffectActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredHandActivatedEffectActions: () => [],
    getRegisteredMagicActions: magicLookup,
  },
};

const realCardMap = new Map<string, CardDefinition>(
  [...ALL_CARDS, FILLER, PAYMENT_SPIRIT].map((definition) => [
    definition.cardNo,
    definition,
  ])
);
const getRealDef = (id: string) => realCardMap.get(id);
const REAL_M01 = realCardMap.get("BSAZ03-M01")!;
const REAL_C15 = realCardMap.get("BSAZ02-C15")!;
const realMagicLookup = buildMagicLookup([REAL_M01]);
const realTrainingEngine: Engine = {
  cards: [REAL_M01, REAL_C15, FILLER, PAYMENT_SPIRIT],
  getCardDefinitionById: getRealDef,
  lookups: {
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => [],
    getRegisteredBattleImmediateEffectActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredHandActivatedEffectActions: () => [],
    getRegisteredMagicActions: realMagicLookup,
  },
};

function buildState(
  options: {
    reserveNormalCoreCount?: number;
    taxed?: boolean;
    extraHandFillerCount?: number;
  } = {}
): GameState {
  const magic = createCardInstance(TEST_MAGIC, {
    instanceId: "discount-magic",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const triggerCard = createCardInstance(TRIGGER_ON_TRASH, {
    instanceId: "hand-trigger",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const fillerA = createCardInstance(FILLER, {
    instanceId: "hand-filler-a",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const fillerB = createCardInstance(FILLER, {
    instanceId: "hand-filler-b",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const extraFillers = Array.from(
    { length: options.extraHandFillerCount ?? 0 },
    (_, index) =>
      createCardInstance(FILLER, {
        instanceId: `hand-extra-filler-${index}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      })
  );
  const tax = createCardInstance(MAGIC_ADDITIONAL_COST_TAX, {
    instanceId: "opponent-magic-tax",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
  });
  const state = {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        magic,
        triggerCard,
        fillerA,
        fillerB,
        ...extraFillers,
        ...(options.taxed ? [tax] : []),
      ],
      playerOverrides: [
        {
          reserveNormalCoreCount: options.reserveNormalCoreCount ?? 5,
          handCount: 4 + extraFillers.length,
        },
        { reserveNormalCoreCount: 0 },
      ],
    }),
    activePlayerId: ALICE,
    step: "main",
    window: "main_step",
  };
  return options.taxed
    ? recomputeAndRebuildContinuousEffects(state, getDef)
    : state;
}

describe("BSAZ03-M01 effects[1b]: 使用時、手札を3枚まで破棄・破棄1枚につきコスト-1", () => {
  it("zone_discount_variable の legal action が候補(自身除く手札3枚)・per-card軽減・maxCountを持つ", () => {
    const state = buildState();
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    });
    const action = actions.find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "discount-magic" &&
        a.costMode === "zone_discount_variable"
    );
    expect(action).toBeDefined();
    if (!action || action.kind !== "use_magic") return;
    expect(action.zoneCostDiscountPerCard).toBe(-1);
    expect(action.zoneCostPaymentMaxCount).toBe(3);
    expect(action.zoneCostPaymentCandidateIds?.sort()).toEqual([
      "hand-filler-a",
      "hand-filler-b",
      "hand-trigger",
    ]);
    // best-case (3枚破棄) の表示コストは 5-3=2。
    expect(action.finalCost).toBe(2);
  });

  it("training input は破棄枚数ごとの selectedZoneCardIds と実コスト支払いを組にする", () => {
    const state = buildState();
    const action = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).find(
      (candidate) =>
        candidate.kind === "use_magic" &&
        candidate.sourceInstanceId === "discount-magic" &&
        candidate.costMode === "zone_discount_variable"
    );
    expect(action).toBeDefined();
    if (!action || action.kind !== "use_magic") return;

    const inputNode = createActionInputDecisionNode(state, action, {
      getCardDefinitionById: getDef,
      maxGeneratedChoices: 64,
    });
    expect(inputNode).not.toBeNull();
    const inputs = inputNode!.choices.map((choice) => choice.applyOptions!);

    expect(inputs).toContainEqual({
      selectedZoneCardIds: [],
      paymentSources: [{ kind: "reserve", amount: 5 }],
    });
    expect(
      inputs.some(
        (input) =>
          input.selectedZoneCardIds?.slice().sort().join(",") ===
            ["hand-filler-a", "hand-trigger"].join(",") &&
          input.paymentSources?.length === 1 &&
          input.paymentSources[0]?.kind === "reserve" &&
          input.paymentSources[0]?.amount === 3
      )
    ).toBe(true);
    expect(
      inputs.every((input) => input.selectedZoneCardIds !== undefined)
    ).toBe(true);
  });

  it("wide input は破棄候補を逐次選択してから依存する支払いだけを列挙する", () => {
    const state = buildState({
      reserveNormalCoreCount: 5,
      extraHandFillerCount: 6,
    });
    const action = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...trainingEngine.lookups,
    }).find(
      (candidate) =>
        candidate.kind === "use_magic" &&
        candidate.sourceInstanceId === "discount-magic" &&
        candidate.costMode === "zone_discount_variable"
    );
    expect(action).toBeDefined();
    if (!action || action.kind !== "use_magic") return;
    expect(action.zoneCostPaymentCandidateIds).toHaveLength(9);

    const surfaceOptions = {
      getCardDefinitionById: getDef,
      maxGeneratedChoices: 1024,
    };
    let current = state;
    let node = createActionInputDecisionNode(current, action, surfaceOptions);
    const selectedIds: string[] = [];
    for (
      let candidateIndex = 0;
      candidateIndex < action.zoneCostPaymentCandidateIds!.length;
      candidateIndex++
    ) {
      expect(node).toMatchObject({
        kind: "action_input",
        fields: ["selectedZoneCardIds"],
        truncated: false,
      });
      expect(node?.choices.length).toBeLessThanOrEqual(2);
      const select = candidateIndex < 2;
      if (select) {
        selectedIds.push(action.zoneCostPaymentCandidateIds![candidateIndex]!);
      }
      const choice = node?.choices.find(
        (candidate) =>
          candidate.systemAction?.kind === "select_factored_zone_selection" &&
          candidate.systemAction.candidateIndex === candidateIndex &&
          candidate.systemAction.select === select
      );
      expect(choice).toBeDefined();
      current = applyTrainingDecisionChoice(
        current,
        node!,
        choice!,
        trainingEngine
      );
      node = getNextTrainingDecision(current, trainingEngine, surfaceOptions);
    }

    expect(node).toMatchObject({
      kind: "action_input",
      fields: ["paymentSources"],
      truncated: false,
    });
    expect(node?.choices.length).toBeLessThan(64);
    expect(
      node?.choices.every(
        (choice) =>
          choice.applyOptions?.selectedZoneCardIds?.join("\0") ===
          selectedIds.join("\0")
      )
    ).toBe(true);
    const paymentChoice = node?.choices.find(
      (choice) =>
        choice.applyOptions?.paymentSources?.length === 1 &&
        choice.applyOptions.paymentSources[0]?.kind === "reserve" &&
        choice.applyOptions.paymentSources[0]?.amount === 3
    );
    expect(paymentChoice?.applyOptions).toBeDefined();
    if (!node || !paymentChoice?.applyOptions) return;

    const expected = applyLegalAction({
      state,
      action,
      ...paymentChoice.applyOptions,
      getCardDefinitionById: getDef,
      ...trainingEngine.lookups,
    }).state;
    current = applyTrainingDecisionChoice(
      current,
      node,
      paymentChoice,
      trainingEngine
    );
    expect(current).toEqual(expected);
  });
  it("wide input は支払い不能になる skip 分岐を提示しない", () => {
    const state = buildState({
      reserveNormalCoreCount: 2,
      extraHandFillerCount: 6,
    });
    const action = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...trainingEngine.lookups,
    }).find(
      (candidate) =>
        candidate.kind === "use_magic" &&
        candidate.sourceInstanceId === "discount-magic" &&
        candidate.costMode === "zone_discount_variable"
    );
    expect(action).toBeDefined();
    if (!action || action.kind !== "use_magic") return;

    const surfaceOptions = {
      getCardDefinitionById: getDef,
      maxGeneratedChoices: 1024,
    };
    let current = state;
    let node = createActionInputDecisionNode(current, action, surfaceOptions);
    let selectedCount = 0;
    for (
      let candidateIndex = 0;
      candidateIndex < action.zoneCostPaymentCandidateIds!.length;
      candidateIndex++
    ) {
      const skip = node?.choices.find(
        (candidate) =>
          candidate.systemAction?.kind === "select_factored_zone_selection" &&
          candidate.systemAction.candidateIndex === candidateIndex &&
          candidate.systemAction.select === false
      );
      const choice =
        skip ??
        node?.choices.find(
          (candidate) =>
            candidate.systemAction?.kind === "select_factored_zone_selection" &&
            candidate.systemAction.candidateIndex === candidateIndex &&
            candidate.systemAction.select === true
        );
      expect(choice).toBeDefined();
      if (choice?.systemAction?.kind === "select_factored_zone_selection") {
        selectedCount += choice.systemAction.select ? 1 : 0;
      }
      current = applyTrainingDecisionChoice(
        current,
        node!,
        choice!,
        trainingEngine
      );
      expect(() => {
        node = getNextTrainingDecision(current, trainingEngine, surfaceOptions);
      }).not.toThrow();
    }

    expect(selectedCount).toBe(3);
    expect(node).toMatchObject({
      kind: "action_input",
      fields: ["paymentSources"],
      truncated: false,
    });
    expect(node?.choices.length).toBeGreaterThan(0);
  });

  it("BSAZ03-M01型の固定対象×可変破棄軽減を段階化し、対象を最終入力へ保持する", () => {
    const initial = buildState({
      reserveNormalCoreCount: 5,
      extraHandFillerCount: 10,
    });
    const paymentSources = Array.from({ length: 5 }, (_, index) =>
      createCardInstance(FILLER, {
        instanceId: `wide-payment-source-${index}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 3,
      })
    );
    const targets = Array.from({ length: 1 }, (_, index) =>
      createCardInstance(FILLER, {
        instanceId: `wide-target-${index}`,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
      })
    );
    const state: GameState = {
      ...initial,
      cardInstances: [...initial.cardInstances, ...paymentSources, ...targets],
    };
    const baseAction = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...trainingEngine.lookups,
    }).find(
      (candidate) =>
        candidate.kind === "use_magic" &&
        candidate.sourceInstanceId === "discount-magic" &&
        candidate.costMode === "zone_discount_variable"
    );
    expect(baseAction).toBeDefined();
    if (!baseAction || baseAction.kind !== "use_magic") return;

    // replay と同じく、借用先マジックの対象は候補1枚・必須1枚で選択分岐ではない。
    // それでも targetInstanceIds を別入力として扱うと、13枚から5枚までの破棄集合と
    // 支払い割当の段階化が抑止され、ticket と同じ truncated surface になる。
    const action = {
      ...baseAction,
      actionId: "bsaz03-m01-target-variable-discount",
      targetMode: "manual",
      requiredTargetCount: 1,
      candidateTargetInstanceIds: targets.map((target) => target.instanceId),
      zoneCostPaymentMaxCount: 5,
      additionalCost: -5,
      finalCost: 0,
      availableOnBoardCoreSources: paymentSources.map((source) => ({
        instanceId: source.instanceId,
        availableCoreAmount: 3,
      })),
    } as LegalAction;
    const surfaceOptions = {
      getCardDefinitionById: getDef,
      maxGeneratedChoices: 1024,
    };
    let current = state;
    let node = createActionInputDecisionNode(current, action, surfaceOptions);
    const selectedTargetIds = [targets[0]!.instanceId];

    expect(node).toMatchObject({
      kind: "action_input",
      fields: ["selectedZoneCardIds"],
      truncated: false,
    });
    for (
      let candidateIndex = 0;
      candidateIndex < action.zoneCostPaymentCandidateIds!.length;
      candidateIndex++
    ) {
      const select = candidateIndex === 0;
      const choice = node?.choices.find(
        (candidate) =>
          candidate.systemAction?.kind === "select_factored_zone_selection" &&
          "select" in candidate.systemAction &&
          candidate.systemAction.candidateIndex === candidateIndex &&
          candidate.systemAction.select === select
      );
      expect(choice).toBeDefined();
      current = applyTrainingDecisionChoice(
        current,
        node!,
        choice!,
        trainingEngine
      );
      node = createActionInputDecisionNode(current, action, surfaceOptions);
    }

    expect(node).toMatchObject({
      kind: "action_input",
      truncated: false,
    });
    expect(node?.fields).toEqual(["paymentSources"]);
    expect(
      node?.choices.every(
        (choice) =>
          choice.applyOptions?.targetInstanceIds?.join("\0") ===
          selectedTargetIds.join("\0")
      )
    ).toBe(true);

    // Applying the fixed-subset payment must preserve the forced borrowed
    // target in the atomic magic action and clear the training-only draft.
    const paymentChoice = node?.choices.find(
      (candidate) => candidate.applyOptions?.paymentSources !== undefined
    );
    expect(paymentChoice).toBeDefined();
    current = applyTrainingDecisionChoice(
      current,
      node!,
      paymentChoice!,
      trainingEngine
    );
    expect(
      current.cardInstances.find((card) => card.instanceId === "discount-magic")
        ?.zone
    ).toBe("in_use");
    expect("trainingVariableZoneDiscountDraft" in current).toBe(false);
  });

  it("実カードBSAZ03-M01→BSAZ02-C15でも固定対象を保持し、借用効果の解決でデッキ下へ戻す", () => {
    const handFillers = Array.from({ length: 13 }, (_, index) =>
      createCardInstance(FILLER, {
        instanceId: `real-hand-filler-${index}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      })
    );
    const paymentSources = Array.from({ length: 5 }, (_, index) =>
      createCardInstance(PAYMENT_SPIRIT, {
        instanceId: `real-payment-source-${index}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 3,
      })
    );
    const target = createCardInstance(PAYMENT_SPIRIT, {
      instanceId: "real-borrowed-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const m01 = createCardInstance(REAL_M01, {
      instanceId: "real-m01",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const donor = createCardInstance(REAL_C15, {
      instanceId: "real-c15-donor",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [m01, donor, target, ...handFillers, ...paymentSources],
        playerOverrides: [
          { reserveNormalCoreCount: 0, handCount: handFillers.length + 1 },
          { reserveNormalCoreCount: 0 },
        ],
      }),
      activePlayerId: ALICE,
      step: "attack",
      window: "flash_before_block",
      activeAttack: {
        attackId: "bsaz03-m01-wide-input",
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
    const action = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getRealDef,
      ...realTrainingEngine.lookups,
    }).find(
      (candidate) =>
        candidate.kind === "use_magic" &&
        candidate.sourceInstanceId === m01.instanceId &&
        candidate.costMode === "zone_discount_variable"
    );
    expect(action).toBeDefined();
    if (!action || action.kind !== "use_magic") return;
    // M01 の action-level target は借用元 C15。唯一の候補なので policy input
    // ではないが、段階化後の最終 use_magic へ必ず持ち越す必要がある。
    expect(action.candidateTargetInstanceIds).toEqual([donor.instanceId]);

    const surfaceOptions = {
      getCardDefinitionById: getRealDef,
      maxGeneratedChoices: 1024,
    };
    let current = state;
    let node = createActionInputDecisionNode(current, action, surfaceOptions);
    expect(node).toMatchObject({
      kind: "action_input",
      fields: ["selectedZoneCardIds"],
      truncated: false,
    });
    for (
      let candidateIndex = 0;
      candidateIndex < action.zoneCostPaymentCandidateIds!.length;
      candidateIndex++
    ) {
      const choice = node?.choices.find(
        (candidate) =>
          candidate.systemAction?.kind === "select_factored_zone_selection" &&
          "select" in candidate.systemAction &&
          candidate.systemAction.candidateIndex === candidateIndex &&
          candidate.systemAction.select === candidateIndex < 5
      );
      expect(choice).toBeDefined();
      current = applyTrainingDecisionChoice(
        current,
        node!,
        choice!,
        realTrainingEngine
      );
      node = createActionInputDecisionNode(current, action, surfaceOptions);
    }
    expect(node?.fields).toEqual(["paymentSources"]);
    const paymentChoice = node?.choices.find(
      (candidate) => candidate.applyOptions?.paymentSources !== undefined
    );
    expect(paymentChoice?.applyOptions?.targetInstanceIds).toEqual([
      donor.instanceId,
    ]);
    current = applyTrainingDecisionChoice(
      current,
      node!,
      paymentChoice!,
      realTrainingEngine
    );

    for (
      let guard = 0;
      guard < 8 && current.activeAttack?.flashWindowState?.pendingStackAction;
      guard++
    ) {
      const pass = getLegalActions({
        state: current,
        actingPlayerId: current.activeAttack.flashWindowState.priorityPlayerId,
        getCardDefinitionById: getRealDef,
        ...realTrainingEngine.lookups,
      }).find((candidate) => candidate.kind === "pass_battle_flash");
      expect(pass).toBeDefined();
      if (!pass) break;
      current = applyLegalAction({
        state: current,
        action: pass,
        getCardDefinitionById: getRealDef,
        ...realTrainingEngine.lookups,
      }).state;
    }

    expect(
      current.activeAttack?.flashWindowState?.pendingStackAction
    ).toBeNull();
    expect(
      current.cardInstances.find(
        (card) => card.instanceId === target.instanceId
      )?.zone
    ).toBe("deck");
    expect(
      current.cardInstances.find((card) => card.instanceId === donor.instanceId)
        ?.zone
    ).toBe("field");
  });

  it("wide input は固定済み破棄後の全 field 支払い割当も逐次選択にする", () => {
    const fieldPaymentSources = Array.from({ length: 12 }, (_, index) =>
      createCardInstance(FILLER, {
        instanceId: `field-payment-${index}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const initial = buildState({ reserveNormalCoreCount: 0 });
    const state: GameState = {
      ...initial,
      cardInstances: [...initial.cardInstances, ...fieldPaymentSources],
    };
    const action = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...trainingEngine.lookups,
    }).find(
      (candidate) =>
        candidate.kind === "use_magic" &&
        candidate.sourceInstanceId === "discount-magic" &&
        candidate.costMode === "zone_discount_variable"
    );
    expect(action).toBeDefined();
    if (!action || action.kind !== "use_magic") return;

    const surfaceOptions = {
      getCardDefinitionById: getDef,
      maxGeneratedChoices: 64,
    };
    let current = state;
    let node = createActionInputDecisionNode(current, action, surfaceOptions);
    for (
      let candidateIndex = 0;
      candidateIndex < action.zoneCostPaymentCandidateIds!.length;
      candidateIndex++
    ) {
      const choice = node?.choices.find(
        (candidate) =>
          candidate.systemAction?.kind === "select_factored_zone_selection" &&
          "select" in candidate.systemAction &&
          candidate.systemAction.candidateIndex === candidateIndex &&
          candidate.systemAction.select
      );
      expect(choice).toBeDefined();
      current = applyTrainingDecisionChoice(
        current,
        node!,
        choice!,
        trainingEngine
      );
      node = getNextTrainingDecision(current, trainingEngine, surfaceOptions);
    }

    const cappedPaymentNode = getNextTrainingDecision(current, trainingEngine, {
      ...surfaceOptions,
      maxGeneratedChoices: 1,
    });
    expect(cappedPaymentNode).toMatchObject({
      kind: "action_input",
      fields: ["paymentSources"],
      truncated: true,
    });
    expect(cappedPaymentNode?.choices).toHaveLength(1);

    for (
      let sourceIndex = 0;
      sourceIndex < fieldPaymentSources.length;
      sourceIndex++
    ) {
      expect(node).toMatchObject({
        kind: "action_input",
        fields: ["paymentSources"],
        truncated: false,
      });
      const paymentSource =
        sourceIndex < 2
          ? fieldPaymentSources[sourceIndex]!.instanceId
          : undefined;
      const choice = node?.choices.find(
        (candidate) =>
          candidate.systemAction?.kind === "select_factored_zone_selection" &&
          "paymentSource" in candidate.systemAction &&
          (paymentSource === undefined
            ? candidate.systemAction.paymentSource === undefined
            : candidate.systemAction.paymentSource?.kind === "card" &&
              candidate.systemAction.paymentSource.instanceId === paymentSource)
      );
      expect(choice).toBeDefined();
      current = applyTrainingDecisionChoice(
        current,
        node!,
        choice!,
        trainingEngine
      );
      if (sourceIndex < fieldPaymentSources.length - 1) {
        node = getNextTrainingDecision(current, trainingEngine, surfaceOptions);
      }
    }

    expect(
      current.cardInstances.find((card) => card.instanceId === "discount-magic")
        ?.zone
    ).toBe("in_use");
    for (const [index, source] of fieldPaymentSources.entries()) {
      expect(
        current.cardInstances.find(
          (card) => card.instanceId === source.instanceId
        )?.normalCoreCount
      ).toBe(index < 2 ? 0 : 1);
    }
  });

  it("相手のマジック追加コスト下では固定税を保った実コストの input を適用できる", () => {
    const state = buildState({ reserveNormalCoreCount: 8, taxed: true });
    const action = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).find(
      (candidate) =>
        candidate.kind === "use_magic" &&
        candidate.sourceInstanceId === "discount-magic" &&
        candidate.costMode === "zone_discount_variable"
    );
    expect(action).toBeDefined();
    if (!action || action.kind !== "use_magic") return;
    expect(action.additionalCost).toBe(0); // +3 tax と最大3枚の -3 が相殺済み

    const inputNode = createActionInputDecisionNode(state, action, {
      getCardDefinitionById: getDef,
      maxGeneratedChoices: 128,
    });
    const input = inputNode?.choices.find(
      (choice) =>
        choice.applyOptions?.selectedZoneCardIds?.slice().sort().join(",") ===
          ["hand-filler-a", "hand-trigger"].join(",") &&
        choice.applyOptions.paymentSources?.length === 1 &&
        choice.applyOptions.paymentSources[0]?.kind === "reserve" &&
        choice.applyOptions.paymentSources[0]?.amount === 6
    );
    expect(input).toBeDefined();
    if (!input?.applyOptions) return;

    const result = applyLegalAction({
      state,
      action,
      ...input.applyOptions,
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).state;
    expect(
      result.players.find((player) => player.id === ALICE)
        ?.reserveNormalCoreCount
    ).toBe(2);
  });

  it("2枚破棄で選択すると実コストが5-2=3になり、破棄カードは手札→トラッシュへ移動する", () => {
    const state = buildState();
    const action = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "discount-magic" &&
        a.costMode === "zone_discount_variable"
    );
    expect(action).toBeDefined();
    if (!action || action.kind !== "use_magic") return;

    const result = applyLegalAction({
      state,
      action,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      selectedZoneCardIds: ["hand-filler-a", "hand-trigger"],
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).state;

    expect(
      result.cardInstances.find((c) => c.instanceId === "discount-magic")?.zone
    ).toBe("in_use");
    expect(
      result.cardInstances.find((c) => c.instanceId === "hand-filler-a")?.zone
    ).toBe("trash");
    // moved_to_trash は mandatory・無条件だが、discard_hand 払いは moveCardZone 直呼びで
    // processMovedToTrashEffects を経由しないため、手札へ戻らずトラッシュに留まる
    // (原文「破棄したカードの効果は発揮されない」)。
    expect(
      result.cardInstances.find((c) => c.instanceId === "hand-trigger")?.zone
    ).toBe("trash");
    // 未選択のフィラーは手札のまま。
    expect(
      result.cardInstances.find((c) => c.instanceId === "hand-filler-b")?.zone
    ).toBe("hand");
    const alice = result.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(2);
  });

  it("0枚破棄なら通常コスト5をそのまま払って使用できる", () => {
    const state = buildState();
    const action = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "discount-magic" &&
        a.costMode === "zone_discount_variable"
    );
    expect(action).toBeDefined();
    if (!action || action.kind !== "use_magic") return;

    const result = applyLegalAction({
      state,
      action,
      paymentSources: [{ kind: "reserve", amount: 5 }],
      selectedZoneCardIds: [],
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).state;

    expect(
      result.cardInstances.find((c) => c.instanceId === "hand-filler-a")?.zone
    ).toBe("hand");
    expect(
      result.cardInstances.find((c) => c.instanceId === "hand-trigger")?.zone
    ).toBe("hand");
    const alice = result.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(0);
  });
});
