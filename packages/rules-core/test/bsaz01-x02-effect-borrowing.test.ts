import { resumeStackCascadeIfReady } from "../src/legal/stack-resolution-core";
/**
 * BSAZ01-X02「KG-6 スレイプニール[最終決戦]」effects textRef[3,4]:
 * 「Lv1-Lv2『このスピリットのアタック/ブロック時』ターンに1回、手札/フィールドの
 * 系統：「地球」を持つマジックカード1枚のフラッシュ効果をただちに発揮する。この
 * とき手札から効果を発揮するマジックカードはフィールドに置く。」
 *
 * BSAZ03-M01 effects[2,3] と同型の `borrow_magic_effect`（bsaz03-m01-effect-borrowing.test.ts
 * 参照）だが、借用元ゾーンが trash 固定ではなく hand/field 両対応、かつ
 * 「手札の対象をフィールドに置いてから本文を発揮する」＝フィールド由来の借用元は動かさない、という
 * 非対称な配置ルールを持つ。選択 → 配置 → 本文の順序を検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect as executeEffectBody,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const X02 = cardNoMap.get("BSAZ01-X02")!;

const ALICE = "alice";
const BOB = "bob";

function donorDef(
  cardNo: string,
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: `テスト借用元 ${cardNo}`,
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    tribe: "地球",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
        textRef: [0],
      },
    ],
    ...overrides,
  } as CardDefinition;
}

const DONOR_ELIGIBLE = donorDef("TEST-X02-DONOR-ELIGIBLE");
const DONOR_WRONG_TRIBE = donorDef("TEST-X02-DONOR-WRONG-TRIBE", {
  tribe: "闘神",
});
const testDefs = new Map<string, CardDefinition>(
  [DONOR_ELIGIBLE, DONOR_WRONG_TRIBE].map((d) => [d.cardNo, d])
);
const getCardDefinitionById = (id: string) =>
  cardNoMap.get(id) ?? testDefs.get(id);

function borrowEffect() {
  return X02.effects!.find((e) =>
    e.steps.some((s) => s.action.kind === "borrow_magic_effect")
  )!;
}

function stateWithDonor(zone: "hand" | "field"): GameState {
  const x02Instance = createCardInstance(X02, {
    instanceId: "alice-x02",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    cores: 1,
  });
  const donorInstance = createCardInstance(DONOR_ELIGIBLE, {
    instanceId: "alice-donor",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone,
  });
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [x02Instance, donorInstance],
  });
}

describe("BSAZ01-X02 textRef[3,4]: 手札/フィールドの地球マジックのフラッシュ効果借用", () => {
  it("手札の対象を先に配置し、マジック本文は配置済みの自身を参照する", () => {
    const donor = donorDef(DONOR_ELIGIBLE.cardNo, {
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              condition: [
                {
                  kind: "field_has",
                  player: "self",
                  cardNames: [{ exact: DONOR_ELIGIBLE.name }],
                },
              ],
              action: { kind: "count_increase", player: "self", amount: 1 },
            },
          ],
        },
      ],
    });
    const after = executeEffect({
      chainId: "test:bsaz01-x02-effect-borrowing:116",
      state: stateWithDonor("hand"),
      effect: borrowEffect(),
      sourceInstanceId: "alice-x02",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) =>
        id === donor.cardNo ? donor : getCardDefinitionById(id),
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["alice-donor"],
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "alice-donor")?.zone
    ).toBe("field");
    expect(after.players.find((p) => p.id === ALICE)?.countValue).toBe(1);
  });

  it("card-data: 非stub・強制(executionMode省略)・per_instance/turn・zone:[hand,field]・fromZone:[hand]", () => {
    const effect = borrowEffect();
    expect(effect.stub).toBeUndefined();
    // 原文「発揮する」は終止形＝強制。「発揮できる」ではないため executionMode:"optional" は誤り
    // (10_rules/03c「する」vs「できる」、adversarial verifier round1 refute 対応)。
    expect(effect.executionMode).toBeUndefined();
    expect(effect.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("borrow_magic_effect");
    if (action.kind !== "borrow_magic_effect") throw new Error("unreachable");
    expect(action.borrowModes).toEqual(["flash"]);
    expect(action.beforeMove).toEqual({
      zone: "field",
      fromZone: ["hand"],
    });
    expect(action.target).toEqual({
      kind: "filter",
      player: "self",
      zone: ["hand", "field"],
      filter: {
        category: ["magic"],
        tribes: ["地球"],
        hasActivatedEffectMode: ["flash"],
      },
      count: 1,
    });
  });

  it("実行: 手札の地球マジックを借用すると効果(draw)が発揮され、借用元は手札からフィールドへ移る", () => {
    const state = stateWithDonor("hand");
    const before = state.players.find((p) => p.id === ALICE)!.handCount;

    const after = executeEffect({
      chainId: "test:bsaz01-x02-effect-borrowing:167",
      state,
      effect: borrowEffect(),
      sourceInstanceId: "alice-x02",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["alice-donor"],
    });

    // draw 1 が発揮された分 handCount は変わらない (借用元自身が手札を離れる -1 と
    // draw +1 が相殺) ため、借用元の zone 遷移そのもので検証する。
    const donor = after.cardInstances.find(
      (c) => c.instanceId === "alice-donor"
    )!;
    expect(donor.zone).toBe("field");
    expect(
      after.log.some(
        (l) => l === "borrow_magic_effect:executed:TEST-X02-DONOR-ELIGIBLE"
      )
    ).toBe(true);
    void before;
  });

  it("実行: フィールドの地球マジックを借用しても効果は発揮され、借用元はフィールドに留まる(再配置されない)", () => {
    const state = stateWithDonor("field");

    const after = executeEffect({
      chainId: "test:bsaz01-x02-effect-borrowing:194",
      state,
      effect: borrowEffect(),
      sourceInstanceId: "alice-x02",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["alice-donor"],
    });

    const donor = after.cardInstances.find(
      (c) => c.instanceId === "alice-donor"
    )!;
    expect(donor.zone).toBe("field");
    expect(
      after.log.some(
        (l) => l === "borrow_magic_effect:executed:TEST-X02-DONOR-ELIGIBLE"
      )
    ).toBe(true);
  });

  it("対象フィルタ: 系統不一致の地球以外マジックは候補から除外される (手札/フィールド両ゾーンで)", () => {
    const x02Instance = createCardInstance(X02, {
      instanceId: "alice-x02",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const wrongHand = createCardInstance(DONOR_WRONG_TRIBE, {
      instanceId: "alice-wrong-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const eligibleField = createCardInstance(DONOR_ELIGIBLE, {
      instanceId: "alice-eligible-field",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [x02Instance, wrongHand, eligibleField],
    });

    const after = executeEffect({
      chainId: "test:bsaz01-x02-effect-borrowing:239",
      state,
      effect: borrowEffect(),
      sourceInstanceId: "alice-x02",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(
      after.log.some(
        (l) => l === "borrow_magic_effect:executed:TEST-X02-DONOR-ELIGIBLE"
      )
    ).toBe(true);
    const wrongAfter = after.cardInstances.find(
      (c) => c.instanceId === "alice-wrong-hand"
    )!;
    expect(wrongAfter.zone).toBe("hand"); // 対象にならず手札のまま
  });

  it("借用先候補が0件 (適格な地球マジックが手札/フィールドどちらにも無い) のとき、mandatory 効果でも安全に no-op する (adversarial verifier round2 深掘り: 空撃ちcollapseを exercise)", () => {
    const x02Instance = createCardInstance(X02, {
      instanceId: "alice-x02",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [x02Instance],
    });

    expect(() =>
      executeEffect({
        chainId: "test:bsaz01-x02-effect-borrowing:272",
        state,
        effect: borrowEffect(),
        sourceInstanceId: "alice-x02",
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
      })
    ).not.toThrow();

    const after = executeEffect({
      chainId: "test:bsaz01-x02-effect-borrowing:282",
      state,
      effect: borrowEffect(),
      sourceInstanceId: "alice-x02",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(after.log.some((l) => l.startsWith("borrow_magic_effect:"))).toBe(
      false
    );
    expect(after.pendingStepOptionalChoice).toBeNull();
    expect(after.cardInstances).toHaveLength(1); // 盤面変化なし
  });
});

// 単体実行後も、効果発揮後の継続を本番と同じ安定点まで進める。
function executeEffect(
  options: Parameters<typeof executeEffectBody>[0]
): GameState {
  const state = executeEffectBody(options);
  return resumeStackCascadeIfReady(state, {
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions ?? (() => []),
    getRegisteredBurstActions: options.getRegisteredBurstActions ?? (() => []),
  });
}
