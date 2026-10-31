/**
 * ENGINE-summon-symbol-reduction-cost: 「軽減シンボルすべてを満たして召喚できる」
 * (costModifier:"full_reduction" / 型 model.ts SummonAction.fullReduction) 候補フィルタの
 * 実効コスト算出。cluster bsaz02-aldnoah-drive-card-tail の needs-dsl.audit.jsonl:BSAZ02-C06
 * partialProgress (a) から独立した共有プリミティブ (BSAZ01-C13/BSAZ02-C06/BSDB01/BSLH01/
 * BSTH02.7-C06/BSTS01-C04 が共有するギャップ)。
 *
 * 裁定 (needs-ruling.jsonl: ENGINE-summon-symbol-reduction-cost, 2026-07-15訂正):
 * 「満たす」= フィールド供給側シンボルの有無に関わらず、候補カードの軽減シンボル
 * 要求スロット全数 (reductionSymbols.length、treat_as reduction_symbol 加算分含む) を
 * 軽減成立扱いにすること。コストは無条件0ではなく、通常軽減と同じく
 * cost - reductionSlots (下限0) で支払う。
 *
 * 実カード BSTS01-C04 (ゴブタ) Lv2『アタック/ブロック時』効果と実候補 BSTS01-M01 を用いて
 * end-to-end で検証する (resolveSummonFromZoneCandidates 単体 + executeEffect 経由の両方)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  executeSummonSelf,
  executeTokenSummon,
  resolveSummonFromZoneCandidates,
} from "../src/effect/structured-summon";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noTriggerLookup = () => [];

const ALICE = "player-1";
const BOB = "player-2";

const GOBUTA = card("BSTS01-C04"); // cost3, reductionSymbols:[green,blue]
const RANGA = card("BSTS01-M01"); // 系統:暴嵐・剣獣, cost6, reductionSymbols:4x green (+treat_as青)
const RIGUR = card("BSTS01-C02"); // symbolColors:[green]、treat_as symbol/reduction_symbol 青も供給
const TEST_TOKEN: CardDefinition = {
  ...RANGA,
  cardNo: "TEST-FULL-REDUCTION-TOKEN",
  name: "full reduction token",
  keywordTags: ["token"],
  maxTokenDeckCount: 9,
};
const TEST_TOKEN_SOURCE: CardDefinition = {
  ...GOBUTA,
  cardNo: "TEST-FULL-REDUCTION-SOURCE",
  name: "full reduction token source",
  relatedTokenCardNos: [TEST_TOKEN.cardNo],
};
const getDefWithToken = (id: string): CardDefinition | undefined => {
  if (id === TEST_TOKEN.cardNo) return TEST_TOKEN;
  if (id === TEST_TOKEN_SOURCE.cardNo) return TEST_TOKEN_SOURCE;
  return getDef(id);
};

// GOBUTA (BSTS01-C04) 自身も symbolColors:[green] + treat_as(青) を持つため、
// フィールドに出ている限り自身も供給側シンボル源になる (1 entry)。
// RANGA の要求スロットは4 (green×4、各 treat_as で [green,blue])。
function buildState(
  additionalGreenSourceCount: number,
  reserveNormalCoreCount = 4
): GameState {
  const gobuta = createCardInstance(GOBUTA, {
    instanceId: "gobuta",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 3,
  });
  const rangaInHand = createCardInstance(RANGA, {
    instanceId: "ranga-hand",
    ownerPlayerId: ALICE,
    zone: "hand",
  });
  const sources = Array.from({ length: additionalGreenSourceCount }, (_, i) =>
    createCardInstance(RIGUR, {
      instanceId: `rigur-${i}`,
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    })
  );
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [gobuta, rangaInHand, ...sources],
    playerOverrides: [{ reserveNormalCoreCount }, {}],
  });
}

function resolvePendingMultiPlacement(
  state: GameState,
  multiPlacementAllocations: NonNullable<
    Parameters<typeof applyLegalAction>[0]["multiPlacementAllocations"]
  >
): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  }).find((candidate) => candidate.kind === "resolve_pending_multi_placement");
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
    multiPlacementAllocations,
  }).state;
}

describe("ENGINE-summon-symbol-reduction-cost: full_reduction 候補フィルタ", () => {
  it("resolveSummonFromZoneCandidates: 供給シンボル不足でも候補に含まれる", () => {
    const state = buildState(0);
    const candidates = resolveSummonFromZoneCandidates(
      state,
      ALICE,
      {
        zone: "hand",
        filter: { category: ["spirit"], tribes: ["剣獣"] },
        fullReduction: true,
      },
      getDef
    );
    expect(candidates.map((c) => c.instanceId)).toContain("ranga-hand");
  });

  it("resolveSummonFromZoneCandidates: 供給充足時も候補に含まれる", () => {
    const state = buildState(3);
    const candidates = resolveSummonFromZoneCandidates(
      state,
      ALICE,
      {
        zone: "hand",
        filter: { category: ["spirit"], tribes: ["剣獣"] },
        fullReduction: true,
      },
      getDef
    );
    expect(candidates.map((c) => c.instanceId)).toContain("ranga-hand");
  });

  it("executeEffect (BSTS01-C04 Lv2 攻撃/ブロック時): 供給不足でも支払いコスト2で召喚する", () => {
    const state = buildState(0);
    const before = state.players.find((p) => p.id === ALICE)!;
    const pendingState = executeEffect({
      chainId: "test:engine-summon-full-reduction-candidate-gate:155",
      summonPaymentSources: [{ kind: "reserve", amount: 2 }],
      state,
      effect: GOBUTA.effects![2]!,
      effectIndex: 2,
      sourceInstanceId: "gobuta",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(pendingState.pendingMultiPlacement).not.toBeNull();
    const after = resolvePendingMultiPlacement(pendingState, [
      {
        destinationInstanceId: "ranga-hand",
        placements: [{ kind: "reserve_normal", amount: 1 }],
      },
    ]);
    const ranga = after.cardInstances.find(
      (c) => c.instanceId === "ranga-hand"
    );
    expect(ranga?.zone).toBe("field");
    expect(ranga?.normalCoreCount).toBe(1);
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(before.reserveNormalCoreCount - alice.reserveNormalCoreCount).toBe(
      3
    );
  });

  it("executeEffect (BSTS01-C04 Lv2 攻撃/ブロック時): reserve不足時はfield上コアで支払いと維持コアを補う", () => {
    const state = buildState(0, 1);
    const pendingState = executeEffect({
      chainId: "test:engine-summon-full-reduction-candidate-gate:184",
      summonPaymentSources: [
        { kind: "reserve", amount: 1 },
        { kind: "card", instanceId: "gobuta", amount: 1 },
      ],
      state,
      effect: GOBUTA.effects![2]!,
      effectIndex: 2,
      sourceInstanceId: "gobuta",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(pendingState.pendingMultiPlacement).not.toBeNull();
    const after = resolvePendingMultiPlacement(pendingState, [
      {
        destinationInstanceId: "ranga-hand",
        placements: [{ kind: "card_normal", instanceId: "gobuta", amount: 1 }],
      },
    ]);
    const ranga = after.cardInstances.find(
      (c) => c.instanceId === "ranga-hand"
    );
    const gobuta = after.cardInstances.find((c) => c.instanceId === "gobuta");
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(ranga?.zone).toBe("field");
    expect(ranga?.normalCoreCount).toBe(1);
    expect(gobuta?.normalCoreCount).toBe(1);
    expect(alice.reserveNormalCoreCount).toBe(0);
  });

  it("executeSummonSelf: 明示したreserveとfield上コアでfull_reduction costを支払う", () => {
    const state = buildState(0, 1);
    const after = executeSummonSelf(
      state,
      "test:engine-summon-full-reduction-candidate-gate:213",
      ALICE,
      {
        kind: "summon",
        target: "self",
        zone: "hand",
        fullReduction: true,
      },
      "ranga-hand",
      getDef,
      [
        { kind: "reserve", amount: 1 },
        { kind: "card", instanceId: "gobuta", amount: 1 },
      ],
      [{ kind: "card_normal", instanceId: "gobuta", amount: 1 }]
    );
    const ranga = after.cardInstances.find(
      (c) => c.instanceId === "ranga-hand"
    );
    const gobuta = after.cardInstances.find((c) => c.instanceId === "gobuta");
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(ranga?.zone).toBe("field");
    expect(ranga?.normalCoreCount).toBe(1);
    expect(gobuta?.normalCoreCount).toBe(1);
    expect(alice.reserveNormalCoreCount).toBe(0);
  });

  it("executeSummonSelf fallback: reserve支払い制限中はreserveをfull_reduction costに使わない", () => {
    const base = buildState(0, 4);
    const noFieldPaymentCores: GameState = {
      ...base,
      cardInstances: base.cardInstances.map((card) =>
        card.instanceId === "gobuta" ? { ...card, normalCoreCount: 0 } : card
      ),
    };
    const restricted = executeEffect({
      chainId: "test:engine-summon-full-reduction-candidate-gate:244",
      state: noFieldPaymentCores,
      effect: {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "restrict_reserve_cost_payment",
              player: "self",
              duration: { scope: "turn" },
            },
          },
        ],
      },
      effectIndex: 99,
      sourceInstanceId: "gobuta",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const after = executeSummonSelf(
      restricted,
      "test:engine-summon-full-reduction-candidate-gate:264",
      ALICE,
      {
        kind: "summon",
        target: "self",
        zone: "hand",
        fullReduction: true,
      },
      "ranga-hand",
      getDef
    );

    const ranga = after.cardInstances.find(
      (card) => card.instanceId === "ranga-hand"
    );
    const alice = after.players.find((player) => player.id === ALICE)!;
    expect(ranga?.zone).toBe("hand");
    expect(alice.reserveNormalCoreCount).toBe(4);
    expect(after.log).toContain(
      "effect:summon:ranga-hand:insufficient-cost:required=2"
    );
  });

  it("executeSummonSelf interactive: placementsだけでは支払元の選択を省略しない", () => {
    const state = buildState(0, 1);
    const after = executeSummonSelf(
      state,
      "test:engine-summon-full-reduction-candidate-gate:290",
      ALICE,
      {
        kind: "summon",
        target: "self",
        zone: "hand",
        fullReduction: true,
      },
      "ranga-hand",
      getDef,
      undefined,
      [{ kind: "card_normal", instanceId: "gobuta", amount: 1 }]
    );
    expect(after.pendingEffectSummonCostPayment?.requiredCost).toBe(2);
    expect(
      after.cardInstances.find((c) => c.instanceId === "gobuta")
        ?.normalCoreCount
    ).toBe(3);
    expect(
      after.players.find((p) => p.id === ALICE)?.reserveNormalCoreCount
    ).toBe(1);
    const ranga = after.cardInstances.find(
      (c) => c.instanceId === "ranga-hand"
    );
    expect(ranga?.zone).toBe("hand");
    expect(ranga?.normalCoreCount).toBe(0);
  });

  it("executeTokenSummon: 同一full_reductionバッチ内の新規tokenを維持コア源に再利用しない", () => {
    const source = createCardInstance(TEST_TOKEN_SOURCE, {
      instanceId: "token-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const payer = createCardInstance(RIGUR, {
      instanceId: "payer",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, payer],
      playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
    });
    const after = executeTokenSummon(
      state,
      "test:engine-summon-full-reduction-candidate-gate.test.ts:summon",
      ALICE,
      2,
      "full_reduction",
      undefined,
      undefined,
      undefined,
      "token-source",
      getDefWithToken,
      undefined,
      undefined,
      [{ kind: "card", instanceId: "payer", amount: 4 }]
    );
    const summonedTokens = after.cardInstances.filter(
      (c) => c.definitionId === TEST_TOKEN.cardNo && c.zone === "field"
    );
    expect(summonedTokens).toHaveLength(0);
    expect(after.log).toContain(
      `effect:summon:token:${ALICE}:${TEST_TOKEN.cardNo}:insufficient-enter-cores:required=2`
    );
  });

  it("executeEffect (BSTS01-C04 Lv2 攻撃/ブロック時): interactive paymentSources は実在ソースを検証する", () => {
    const state = buildState(0, 1);
    expect(() =>
      executeEffect({
        chainId: "test:engine-summon-full-reduction-candidate-gate:356",
        state,
        effect: GOBUTA.effects![2]!,
        effectIndex: 2,
        sourceInstanceId: "gobuta",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        summonPaymentSources: [{ kind: "reserve", amount: 2 }],
      })
    ).toThrow(/Reserve payment exceeds available cores/);
  });

  it("executeEffect (BSTS01-C04 Lv2 攻撃/ブロック時): 供給充足時も支払いコスト2で召喚する", () => {
    const state = buildState(3);
    const before = state.players.find((p) => p.id === ALICE)!;
    const pendingState = executeEffect({
      chainId: "test:engine-summon-full-reduction-candidate-gate:372",
      summonPaymentSources: [{ kind: "reserve", amount: 2 }],
      state,
      effect: GOBUTA.effects![2]!,
      effectIndex: 2,
      sourceInstanceId: "gobuta",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(pendingState.pendingMultiPlacement).not.toBeNull();
    const after = resolvePendingMultiPlacement(pendingState, [
      {
        destinationInstanceId: "ranga-hand",
        placements: [{ kind: "reserve_normal", amount: 1 }],
      },
    ]);
    const ranga = after.cardInstances.find(
      (c) => c.instanceId === "ranga-hand"
    );
    expect(ranga?.zone).toBe("field");
    expect(ranga?.normalCoreCount).toBe(1);
    // full_reduction は無償召喚ではない。RANGA cost6 / reductionSlots4 なので
    // 支払いコスト2 + フィールド進入時の維持コア1 = 合計3コア減少。
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(before.reserveNormalCoreCount - alice.reserveNormalCoreCount).toBe(
      3
    );
  });
});
