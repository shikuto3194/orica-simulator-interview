/**
 * BSAZ01-C06「出撃」effects[2]:
 * 「このカードのコストを支払うとき、自分のフィールドのマジックカードをデッキの下に
 * 戻すことで、戻した枚数1枚につき、1コスト支払ったものとして扱う。」
 *
 * discard_hand (BSAZ03-M01 effects[1b], bsaz03-m01-use-cost-discard-discount.test.ts) と
 * 同じ zone_discount_variable 可変枚数コスト軽減パターンを sourceZone:"field" へ拡張した
 * useCostPayment.kind:"return_to_deck_bottom_field" を検証する。discard_hand と異なり、
 * 実際の返却は magic-system.ts の applyMagicZoneCostPayment が既存汎用効果 send_to_deck
 * (executeSendToDeck) を呼んで行う。field 由来カードは cannot_leave_field /
 * cannot_be_sent_to_deck 耐性を持ちうるため、getMagicZoneCostDiscountOptions
 * (legal-actions-availability.ts) の候補収集時点で耐性保持カードを除外する
 * (adversarial verifier round1 Lens3 指摘の是正: 除外しないと legal action 確定時の
 * 割引額と executeSendToDeck の実移動枚数が食い違い、割引だけ得てカードが場に残る)。
 *
 * 実カード (BSAZ01-C06) は【タイプ：作戦】自己配置・場残置フラッシュ等が絡み検証が
 * 複雑になるため、bsaz03-m01-use-cost-discard-discount.test.ts と同様に専用テストカードで
 * 単離検証する。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildMagicLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffectResistance,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const ALICE = "alice";
const BOB = "bob";

const TEST_MAGIC: CardDefinition = {
  cardNo: "TEST-FIELD-RETURN-DISCOUNT-MAGIC",
  name: "テストフィールド返却割引マジック",
  printedCategory: "magic",
  colors: ["yellow"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    // 使用時、自分フィールドのマジックカードを3枚までデッキの下へ戻し、
    // 戻した枚数1枚につきコスト-1 (BSAZ01-C06 effects[2] 同型)。
    {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "cost_modify",
            target: { kind: "self" },
            modifier: { additionalCostValue: -1 },
            useCostPayment: {
              kind: "return_to_deck_bottom_field",
              sourceZone: "field",
              maxCount: 3,
              filter: { category: ["magic"] },
            },
          },
        },
      ],
      textRef: [0],
    },
    // use_magic legal action を生む本体。
    {
      timing: { kind: "activated", mode: "main" },
      steps: [],
      textRef: [0],
    },
  ],
};

const FIELD_MAGIC: CardDefinition = {
  cardNo: "TEST-FIELD-RETURN-FIELD-MAGIC",
  name: "テスト場マジック",
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

const FIELD_SPIRIT: CardDefinition = {
  cardNo: "TEST-FIELD-RETURN-FIELD-SPIRIT",
  name: "テスト場スピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 2,
  reductionSymbols: ["red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  tribe: "星竜",
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const DECK_FILLER: CardDefinition = {
  cardNo: "TEST-FIELD-RETURN-DECK-FILLER",
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
  [TEST_MAGIC, FIELD_MAGIC, FIELD_SPIRIT, DECK_FILLER].map((c) => [c.cardNo, c])
);
const getDef = (id: string) => cardMap.get(id);
const magicLookup = buildMagicLookup([
  TEST_MAGIC,
  FIELD_MAGIC,
  FIELD_SPIRIT,
  DECK_FILLER,
]);

function buildState(): GameState {
  const magic = createCardInstance(TEST_MAGIC, {
    instanceId: "discount-magic",
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
  const fieldMagicC = createCardInstance(FIELD_MAGIC, {
    instanceId: "field-magic-c",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
  });
  // 自分の場スピリット: category フィルタ不一致のため候補から除外されることを確認する用。
  const fieldSpirit = createCardInstance(FIELD_SPIRIT, {
    instanceId: "field-spirit-alice",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
  });
  // 相手の場マジック: 所有者不一致のため候補から除外されることを確認する用。
  const opponentFieldMagic = createCardInstance(FIELD_MAGIC, {
    instanceId: "field-magic-bob",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
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
        magic,
        fieldMagicA,
        fieldMagicB,
        fieldMagicC,
        fieldSpirit,
        opponentFieldMagic,
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

describe("BSAZ01-C06 effects[2]: 使用時、自分の場マジックを3枚までデッキの下へ戻し、1枚につきコスト-1", () => {
  it("zone_discount_variable の legal action が候補(自分の場マジック3枚のみ)・per-card軽減・maxCountを持つ", () => {
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
    // 自分の場マジック3枚のみ (相手の場マジション・自分の場スピリットは除外)。
    expect(action.zoneCostPaymentCandidateIds?.sort()).toEqual([
      "field-magic-a",
      "field-magic-b",
      "field-magic-c",
    ]);
    // best-case (3枚返却) の表示コストは 3-3=0。
    expect(action.finalCost).toBe(0);
  });

  it("cannot_leave_field 耐性を持つ場マジックは候補から除外される (割引だけ得てカードが場に残る不整合を防止)", () => {
    let state = buildState();
    state = executeEffectResistance(
      state,
      ALICE,
      {
        kind: "effect_resistance",
        target: { selfCard: false, player: "self", count: 1 },
        resistType: "cannot_leave_field",
        source: "all",
        duration: { scope: "permanent" },
      },
      "field-magic-a",
      getDef
    );
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
    // field-magic-a は耐性により候補から除外され、b/c のみが候補になる。
    expect(action.zoneCostPaymentCandidateIds?.sort()).toEqual([
      "field-magic-b",
      "field-magic-c",
    ]);
  });

  it("2枚返却で選択すると実コストが3-2=1になり、返却カードはフィールド→デッキの下(既存デッキカードの後)へ移動し、コアはリザーブに戻る", () => {
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
      paymentSources: [{ kind: "reserve", amount: 1 }],
      selectedZoneCardIds: ["field-magic-a", "field-magic-b"],
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).state;

    expect(
      result.cardInstances.find((c) => c.instanceId === "discount-magic")?.zone
    ).toBe("in_use");

    const movedA = result.cardInstances.find(
      (c) => c.instanceId === "field-magic-a"
    )!;
    const movedB = result.cardInstances.find(
      (c) => c.instanceId === "field-magic-b"
    )!;
    expect(movedA.zone).toBe("deck");
    expect(movedB.zone).toBe("deck");
    // フィールドから離れたカードのコアはリザーブへ戻る (直接除去ではない)。
    expect(movedA.normalCoreCount).toBe(0);

    // 未選択のカードはそのままフィールドに残る。
    expect(
      result.cardInstances.find((c) => c.instanceId === "field-magic-c")?.zone
    ).toBe("field");

    // デッキの下 = 既存デッキカードより後ろに位置する (配列順で判定)。
    const aliceDeckOrder = result.cardInstances
      .filter((c) => c.ownerPlayerId === ALICE && c.zone === "deck")
      .map((c) => c.instanceId);
    expect(aliceDeckOrder.indexOf("deck-filler-top")).toBeLessThan(
      aliceDeckOrder.indexOf("field-magic-a")
    );
    expect(aliceDeckOrder.indexOf("deck-filler-top")).toBeLessThan(
      aliceDeckOrder.indexOf("field-magic-b")
    );

    const alice = result.players.find((p) => p.id === ALICE)!;
    // 返却2枚分デッキ枚数が増え、支払い(reserve 1個消費)後に field-magic-a のコア1個が
    // リザーブへ戻る: 開始3 - 支払い1 + 返却分1 = 3。
    expect(alice.deckCount).toBe(3);
    expect(alice.reserveNormalCoreCount).toBe(3);
  });

  it("0枚返却なら通常コスト3をそのまま払って使用でき、場マジックは全てフィールドに残る", () => {
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
      selectedZoneCardIds: [],
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).state;

    for (const id of ["field-magic-a", "field-magic-b", "field-magic-c"]) {
      expect(result.cardInstances.find((c) => c.instanceId === id)?.zone).toBe(
        "field"
      );
    }
    const alice = result.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(0);
  });
});
