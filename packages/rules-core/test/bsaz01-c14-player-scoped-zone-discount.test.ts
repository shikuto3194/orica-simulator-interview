/**
 * BSAZ01-C14「ダルザナ・マグバレッジ」effects[0] (Lv1-Lv2 前半):
 * 「自分が系統：「地球」を持つマジックカードのコストを支払うとき、自分のフィールドの
 * 系統：「地球」を持つマジックカードをデッキの下に戻すことで、戻した枚数1枚につき、
 * 1コスト支払ったものとして扱う。」
 *
 * BSAZ01-C06 effects[2] (bsaz01-c06-alt-cost-field-magic-return.test.ts) と同じ
 * useCostPayment.kind:"return_to_deck_bottom_field" 可変枚数コスト軽減パターンだが、
 * cost_modify の対象指定が target:{kind:"self"}（カード自身）ではなく
 * player:"self"+cardFilter（フィールドの別カードが持つ、条件一致する任意のマジックカードに
 * 適用される player scope CE）である点が新規（engine-cost-modify-player-scoped-zone-discount:
 * getMagicZoneCostDiscountOptions のスキャン範囲を sourceDefinition 自身の効果から
 * 自分のフィールド全体の player scope cost_modify+useCostPayment へ拡張）。
 *
 * 実カード (BSAZ01-C14) の Lv2『自分のメインステップ』ソウルコア支払いメイン効果借用
 * (effects[1]) は engine-magic-use-soul-core-cost-borrow primitive で解消済み
 * (bsaz01-c14-soul-core-magic-borrow.test.ts 参照)。本ファイルは effects[0] の
 * 単離検証のため引き続き専用テストカードを使う。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildMagicLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const ALICE = "alice";
const BOB = "bob";

const CE_HOLDER: CardDefinition = {
  cardNo: "TEST-PLAYER-ZONE-DISCOUNT-HOLDER",
  name: "テストプレイヤー範囲割引ネクサス",
  printedCategory: "nexus",
  colors: ["yellow"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
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
            player: "self",
            cardFilter: { category: ["magic"], tribes: ["地球"] },
            modifier: { additionalCostValue: -1 },
            useCostPayment: {
              kind: "return_to_deck_bottom_field",
              sourceZone: "field",
              maxCount: 3,
              filter: { category: ["magic"], tribes: ["地球"] },
            },
          },
        },
      ],
      textRef: [0],
    },
  ],
};

// 2枚目の player scope CE 保持カード。CE_HOLDER と割引額/上限枚数を変えて、
// 同一 sourceCard に対し複数の zone_discount_variable option が同時成立する
// ケースを再現する (actionId collision 回帰テスト用)。
const SECOND_CE_HOLDER: CardDefinition = {
  ...CE_HOLDER,
  cardNo: "TEST-PLAYER-ZONE-DISCOUNT-HOLDER-2",
  name: "テストプレイヤー範囲割引ネクサス2",
  effects: [
    {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "cost_modify",
            player: "self",
            cardFilter: { category: ["magic"], tribes: ["地球"] },
            modifier: { additionalCostValue: -2 },
            useCostPayment: {
              kind: "return_to_deck_bottom_field",
              sourceZone: "field",
              maxCount: 2,
              filter: { category: ["magic"], tribes: ["地球"] },
            },
          },
        },
      ],
      textRef: [0],
    },
  ],
};

// 1枚のCE保持カードが独立した2つの player scope cost_modify+useCostPayment
// continuous effect を持つケース。CE 保持カード instanceId は1つだけなので、
// instanceId のみを discriminator にすると2つの option が衝突する
// (actionId collision 回帰テスト、2巡目 adversarial verifier Lens4 指摘)。
const MULTI_EFFECT_CE_HOLDER: CardDefinition = {
  ...CE_HOLDER,
  cardNo: "TEST-PLAYER-ZONE-DISCOUNT-HOLDER-MULTI",
  name: "テストプレイヤー範囲割引ネクサス複数効果",
  effects: [
    {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "cost_modify",
            player: "self",
            cardFilter: { category: ["magic"], tribes: ["地球"] },
            modifier: { additionalCostValue: -1 },
            useCostPayment: {
              kind: "return_to_deck_bottom_field",
              sourceZone: "field",
              maxCount: 3,
              filter: { category: ["magic"], tribes: ["地球"] },
            },
          },
        },
      ],
      textRef: [0],
    },
    {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "cost_modify",
            player: "self",
            cardFilter: { category: ["magic"], tribes: ["地球"] },
            modifier: { additionalCostValue: -2 },
            useCostPayment: {
              kind: "return_to_deck_bottom_field",
              sourceZone: "field",
              maxCount: 2,
              filter: { category: ["magic"], tribes: ["地球"] },
            },
          },
        },
      ],
      textRef: [1],
    },
  ],
};

const TEST_MAGIC: CardDefinition = {
  cardNo: "TEST-PLAYER-ZONE-DISCOUNT-MAGIC",
  name: "テスト地球マジック",
  printedCategory: "magic",
  colors: ["yellow"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  tribe: "地球",
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [],
      textRef: [0],
    },
  ],
};

// tribe 不一致: player scope cardFilter (tribes:["地球"]) に一致しないため
// zoneCostDiscountOptions の対象外になることを確認する用。
const OTHER_TRIBE_MAGIC: CardDefinition = {
  ...TEST_MAGIC,
  cardNo: "TEST-PLAYER-ZONE-DISCOUNT-OTHER-TRIBE-MAGIC",
  name: "テスト非地球マジック",
  tribe: undefined,
};

const FIELD_MAGIC: CardDefinition = {
  cardNo: "TEST-PLAYER-ZONE-DISCOUNT-FIELD-MAGIC",
  name: "テスト場地球マジック",
  printedCategory: "magic",
  colors: ["yellow"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  tribe: "地球",
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const DECK_FILLER: CardDefinition = {
  cardNo: "TEST-PLAYER-ZONE-DISCOUNT-DECK-FILLER",
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
  effects: [],
};

const cardMap = new Map<string, CardDefinition>(
  [
    CE_HOLDER,
    SECOND_CE_HOLDER,
    MULTI_EFFECT_CE_HOLDER,
    TEST_MAGIC,
    OTHER_TRIBE_MAGIC,
    FIELD_MAGIC,
    DECK_FILLER,
  ].map((c) => [c.cardNo, c])
);
const getDef = (id: string) => cardMap.get(id);
const magicLookup = buildMagicLookup([
  CE_HOLDER,
  SECOND_CE_HOLDER,
  MULTI_EFFECT_CE_HOLDER,
  TEST_MAGIC,
  OTHER_TRIBE_MAGIC,
  FIELD_MAGIC,
  DECK_FILLER,
]);

function buildState(options?: {
  ceHolderOwner?: string;
  withSecondCeHolder?: boolean;
}): GameState {
  const ceHolder = createCardInstance(CE_HOLDER, {
    instanceId: "ce-holder",
    ownerPlayerId: options?.ceHolderOwner ?? ALICE,
    controllerPlayerId: options?.ceHolderOwner ?? ALICE,
    zone: "field",
  });
  const secondCeHolder = createCardInstance(SECOND_CE_HOLDER, {
    instanceId: "ce-holder-2",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
  });
  const magic = createCardInstance(TEST_MAGIC, {
    instanceId: "test-magic",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const fieldMagicA = createCardInstance(FIELD_MAGIC, {
    instanceId: "field-magic-a",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const fieldMagicB = createCardInstance(FIELD_MAGIC, {
    instanceId: "field-magic-b",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
  });
  const deckFillerTop = createCardInstance(DECK_FILLER, {
    instanceId: "deck-filler-top",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "deck",
  });
  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        ceHolder,
        ...(options?.withSecondCeHolder ? [secondCeHolder] : []),
        magic,
        fieldMagicA,
        fieldMagicB,
        deckFillerTop,
      ],
      playerOverrides: [
        { reserveNormalCoreCount: 3, handCount: 1, deckCount: 1 },
        { reserveNormalCoreCount: 0 },
      ],
    }),
    activePlayerId: ALICE,
    step: "main",
    window: "main_step",
  };
}

// MULTI_EFFECT_CE_HOLDER (CE 保持カード1枚・独立effect2つ) 用の最小構成state。
function buildMultiEffectHolderState(): GameState {
  const holder = createCardInstance(MULTI_EFFECT_CE_HOLDER, {
    instanceId: "multi-effect-holder",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
  });
  const magic = createCardInstance(TEST_MAGIC, {
    instanceId: "test-magic",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const fieldMagicA = createCardInstance(FIELD_MAGIC, {
    instanceId: "field-magic-a",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
  });
  const fieldMagicB = createCardInstance(FIELD_MAGIC, {
    instanceId: "field-magic-b",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
  });
  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [holder, magic, fieldMagicA, fieldMagicB],
      playerOverrides: [
        { reserveNormalCoreCount: 3, handCount: 1, deckCount: 0 },
        { reserveNormalCoreCount: 0 },
      ],
    }),
    activePlayerId: ALICE,
    step: "main",
    window: "main_step",
  };
}

function findZoneDiscountAction(state: GameState, sourceInstanceId: string) {
  return getLegalActions({
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
      a.sourceInstanceId === sourceInstanceId &&
      a.costMode === "zone_discount_variable"
  );
}

function findZoneDiscountActions(state: GameState, sourceInstanceId: string) {
  return getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredMagicActions: magicLookup,
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredBurstActions: () => undefined,
  }).filter(
    (a) =>
      a.kind === "use_magic" &&
      a.sourceInstanceId === sourceInstanceId &&
      a.costMode === "zone_discount_variable"
  );
}

describe("BSAZ01-C14 effects[0]: player scope cost_modify+useCostPayment (自分のフィールドの別カードが持つ地球マジック向け割引)", () => {
  it("フィールドの CE 保持カードが自分所有のとき、対象マジックに zone_discount_variable が立つ", () => {
    const state = buildState();
    const action = findZoneDiscountAction(state, "test-magic");
    expect(action).toBeDefined();
    if (!action || action.kind !== "use_magic") return;
    expect(action.zoneCostDiscountPerCard).toBe(-1);
    expect(action.zoneCostPaymentMaxCount).toBe(3);
    expect(action.zoneCostPaymentCandidateIds?.sort()).toEqual([
      "field-magic-a",
      "field-magic-b",
    ]);
    // best-case (2枚返却) の表示コストは 3-2=1。
    expect(action.finalCost).toBe(1);
  });

  it("CE 保持カードが相手所有のときは適用されない (player scope が相手側 CE を拾わない)", () => {
    const state = buildState({ ceHolderOwner: BOB });
    const action = findZoneDiscountAction(state, "test-magic");
    expect(action).toBeUndefined();
  });

  it("cardFilter (tribes:地球) に一致しないマジックには適用されない", () => {
    const state = buildState();
    const withOtherTribeMagic: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === "test-magic"
          ? { ...c, definitionId: OTHER_TRIBE_MAGIC.cardNo }
          : c
      ),
    };
    const action = findZoneDiscountAction(withOtherTribeMagic, "test-magic");
    expect(action).toBeUndefined();
  });

  it("1枚返却で選択すると実コストが3-1=2になり、返却カードはフィールド→デッキの下へ移動しコアはリザーブに戻る", () => {
    const state = buildState();
    const action = findZoneDiscountAction(state, "test-magic");
    expect(action).toBeDefined();
    if (!action || action.kind !== "use_magic") return;

    const result = applyLegalAction({
      state,
      action,
      paymentSources: [{ kind: "reserve", amount: 2 }],
      selectedZoneCardIds: ["field-magic-a"],
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).state;

    expect(
      result.cardInstances.find((c) => c.instanceId === "test-magic")?.zone
    ).toBe("in_use");
    const movedA = result.cardInstances.find(
      (c) => c.instanceId === "field-magic-a"
    )!;
    expect(movedA.zone).toBe("deck");
    expect(movedA.normalCoreCount).toBe(0);
    expect(
      result.cardInstances.find((c) => c.instanceId === "field-magic-b")?.zone
    ).toBe("field");

    const alice = result.players.find((p) => p.id === ALICE)!;
    // 開始3 - 支払い2 + 返却分1(field-magic-aの1コア) = 2。
    expect(alice.reserveNormalCoreCount).toBe(2);
  });

  it("同一マジックに対しCE保持カードが2枚存在するとき、actionIdが衝突せずそれぞれ別のcandidate/割引を保持する (actionId collision 回帰)", () => {
    const state = buildState({ withSecondCeHolder: true });
    const actions = findZoneDiscountActions(state, "test-magic");
    expect(actions).toHaveLength(2);
    if (actions[0]?.kind !== "use_magic" || actions[1]?.kind !== "use_magic") {
      throw new Error("expected use_magic actions");
    }
    // actionId が discriminator (option の配列 index) を含み衝突しないこと。
    expect(actions[0].actionId).not.toBe(actions[1].actionId);
    const byDiscount = [actions[0], actions[1]].sort(
      (a, b) =>
        (a.zoneCostDiscountPerCard ?? 0) - (b.zoneCostDiscountPerCard ?? 0)
    );
    // SECOND_CE_HOLDER: -2/最大2枚, CE_HOLDER: -1/最大3枚。
    expect(byDiscount[0]!.zoneCostDiscountPerCard).toBe(-2);
    expect(byDiscount[0]!.zoneCostPaymentMaxCount).toBe(2);
    expect(byDiscount[1]!.zoneCostDiscountPerCard).toBe(-1);
    expect(byDiscount[1]!.zoneCostPaymentMaxCount).toBe(3);
  });

  it("1枚のCE保持カードが独立した2つの継続効果(異なる割引)を持つとき、actionIdが衝突しない (単一instanceId内option衝突の回帰、2巡目 adversarial verifier Lens4 指摘)", () => {
    const state = buildMultiEffectHolderState();
    const actions = findZoneDiscountActions(state, "test-magic");
    expect(actions).toHaveLength(2);
    if (actions[0]?.kind !== "use_magic" || actions[1]?.kind !== "use_magic") {
      throw new Error("expected use_magic actions");
    }
    expect(actions[0].actionId).not.toBe(actions[1].actionId);
    const byDiscount = [actions[0], actions[1]].sort(
      (a, b) =>
        (a.zoneCostDiscountPerCard ?? 0) - (b.zoneCostDiscountPerCard ?? 0)
    );
    expect(byDiscount[0]!.zoneCostDiscountPerCard).toBe(-2);
    expect(byDiscount[0]!.zoneCostPaymentMaxCount).toBe(2);
    expect(byDiscount[1]!.zoneCostDiscountPerCard).toBe(-1);
    expect(byDiscount[1]!.zoneCostPaymentMaxCount).toBe(3);
  });
});
