/**
 * 独立コア管理ネクサス（創界神/導界者/創界石）上のコアはコスト支払いの原資にならない。
 *
 * 背景: 導界者ネクサス BSTH04-XX01 の本文
 *   「そのコアは導界者ネクサス/創界神ネクサス対象の効果しか受けず移動できない」
 * の通り、これらのネクサス上のコアは対象効果でしか動かせず、汎用コスト支払いには使えない。
 *
 * 回帰: snapshot 2026-06-13T18-19-26 で、リザーブ2 + XX01 上の 2 コアを合算して
 * 4コスマジック BSTH04-C12 (軽減後 finalCost=3) が「使用可能」になっていた。
 * 正しくは原資はリザーブ2のみ → 支払い不可。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyCardCostPayments,
  applyEnterFieldCorePlacements,
  createCardInstance,
  createEmptyGameState,
  getAvailableCardCostPaymentSources,
  getAvailableOnBoardCorePaymentSources,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const ALICE = "alice";
const BOB = "bob";
const CARDS_BY_NO = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c as CardDefinition])
);
const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  CARDS_BY_NO.get(id);
const defOf = (n: string): CardDefinition => {
  const d = CARDS_BY_NO.get(n);
  if (!d) throw new Error("missing card def: " + n);
  return d;
};

function boardWithGuidedNexus(): GameState {
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const xx01 = createCardInstance(defOf("BSTH04-XX01"), {
    instanceId: "card-35",
    ownerPlayerId: ALICE,
    zone: "field",
    cores: 2,
  });
  const players = base.players.map((p) =>
    p.id === ALICE ? { ...p, reserveNormalCoreCount: 2 } : p
  );
  const state: GameState = { ...base, players, cardInstances: [xx01] };
  return rebuildContinuousEffectsFromField(state, getCardDefinitionById);
}

function boardWithGrandstone(): GameState {
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const grandstone = createCardInstance(defOf("BSTH001-転醒R01(A)"), {
    instanceId: "grandstone-1",
    ownerPlayerId: ALICE,
    zone: "field",
    cores: 2,
  });
  const players = base.players.map((p) =>
    p.id === ALICE ? { ...p, reserveNormalCoreCount: 2 } : p
  );
  const state: GameState = { ...base, players, cardInstances: [grandstone] };
  return rebuildContinuousEffectsFromField(state, getCardDefinitionById);
}

function getCard(state: GameState, instanceId: string) {
  const card = state.cardInstances.find((c) => c.instanceId === instanceId);
  if (!card) throw new Error(`missing card instance: ${instanceId}`);
  return card;
}

describe("独立コア管理ネクサスのコアはコスト支払い原資から除外される", () => {
  it("導界者ネクサス XX01 は onBoard 支払い源に含まれない", () => {
    const state = boardWithGuidedNexus();
    const sources = getAvailableOnBoardCorePaymentSources(
      state,
      ALICE,
      getCardDefinitionById
    );
    expect(sources).toHaveLength(0);
  });

  it("XX01 1枚のみの盤面で C12 (finalCost=3) はリザーブ2では支払い不可", () => {
    const state = boardWithGuidedNexus();
    const result = getAvailableCardCostPaymentSources({
      state,
      actingPlayerId: ALICE,
      card: defOf("BSTH04-C12"),
      getCardDefinitionById,
    });
    // 軽減: 物理シンボル1個 → finalCost=3
    expect(result.reduction.finalCost).toBe(3);
    // 原資: リザーブ2のみ（XX01 の2コアは除外）
    expect(result.reserveSource.availableCoreAmount).toBe(2);
    expect(result.totalAvailableCoreAmount).toBe(2);
    expect(result.canFullyPay).toBe(false);
  });

  it("通常スピリット上のコアは支払い原資に含まれる（除外は独立コア管理のみ）", () => {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    // 通常スピリット (BSTH04-X02) をコア1で配置
    const spirit = createCardInstance(defOf("BSTH04-X02"), {
      instanceId: "spirit-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const state: GameState = { ...base, cardInstances: [spirit] };
    const sources = getAvailableOnBoardCorePaymentSources(
      state,
      ALICE,
      getCardDefinitionById
    );
    expect(sources).toHaveLength(1);
    expect(sources[0]!.instanceId).toBe("spirit-1");
  });

  it("支払い実行へ XX01 を直指定しても、通常コスト支払いでは拒否する", () => {
    const state = boardWithGuidedNexus();

    expect(() =>
      applyCardCostPayments({
        state,
        actingPlayerId: ALICE,
        chainId: "test-payment",
        paymentSources: [{ kind: "card", instanceId: "card-35", amount: 1 }],
        getCardDefinitionById,
      })
    ).toThrow(/Independent-core cards cannot provide generic cost payment/);
  });

  it("targetsGrandwalker で明示された支払いだけは XX01 のコアを動かせる", () => {
    const state = boardWithGuidedNexus();
    const beforeVoid = state.players.find(
      (p) => p.id === ALICE
    )!.voidNormalCoreCount;

    const next = applyCardCostPayments({
      state,
      actingPlayerId: ALICE,
      chainId: "test-explicit-payment",
      paymentSources: [
        {
          kind: "card",
          instanceId: "card-35",
          amount: 1,
          destination: "void",
        },
      ],
      getCardDefinitionById,
      onBoardCoreSourceFilter: { targetsGrandwalker: true },
    });

    expect(getCard(next, "card-35").normalCoreCount).toBe(1);
    expect(next.players.find((p) => p.id === ALICE)!.voidNormalCoreCount).toBe(
      beforeVoid + 1
    );
  });

  it("targetsGrandstone では XX01 のコア支払いを明示した扱いにしない", () => {
    const state = boardWithGuidedNexus();

    expect(() =>
      applyCardCostPayments({
        state,
        actingPlayerId: ALICE,
        chainId: "test-grandstone-filter-on-guided",
        paymentSources: [
          {
            kind: "card",
            instanceId: "card-35",
            amount: 1,
            destination: "void",
          },
        ],
        getCardDefinitionById,
        onBoardCoreSourceFilter: { targetsGrandstone: true },
      })
    ).toThrow(/Independent-core cards cannot provide generic cost payment/);
  });

  it("targetsGrandwalker では創界石のコア支払いを明示した扱いにしない", () => {
    const state = boardWithGrandstone();

    expect(() =>
      applyCardCostPayments({
        state,
        actingPlayerId: ALICE,
        chainId: "test-grandwalker-filter-on-grandstone",
        paymentSources: [
          {
            kind: "card",
            instanceId: "grandstone-1",
            amount: 1,
            destination: "void",
          },
        ],
        getCardDefinitionById,
        onBoardCoreSourceFilter: { targetsGrandwalker: true },
      })
    ).toThrow(/Independent-core cards cannot provide generic cost payment/);
  });

  it("targetsGrandstone で明示された支払いだけは創界石のコアを動かせる", () => {
    const state = boardWithGrandstone();
    const beforeVoid = state.players.find(
      (p) => p.id === ALICE
    )!.voidNormalCoreCount;

    const next = applyCardCostPayments({
      state,
      actingPlayerId: ALICE,
      chainId: "test-explicit-grandstone-payment",
      paymentSources: [
        {
          kind: "card",
          instanceId: "grandstone-1",
          amount: 1,
          destination: "void",
        },
      ],
      getCardDefinitionById,
      onBoardCoreSourceFilter: { targetsGrandstone: true },
    });

    expect(getCard(next, "grandstone-1").normalCoreCount).toBe(1);
    expect(next.players.find((p) => p.id === ALICE)!.voidNormalCoreCount).toBe(
      beforeVoid + 1
    );
  });
});

describe("独立コア管理ネクサスのコアは通常の場入り維持コア配置にも使えない", () => {
  it("XX01 上のコアを通常ネクサス配置の維持コア元にできない", () => {
    const base = boardWithGuidedNexus();
    const state = {
      ...base,
      cardInstances: [
        ...base.cardInstances,
        createCardInstance(defOf("BSTH01-C12"), {
          instanceId: "normal-nexus",
          ownerPlayerId: ALICE,
          zone: "field",
          cores: 0,
        }),
      ],
    };

    expect(() =>
      applyEnterFieldCorePlacements({
        state,
        actingPlayerId: ALICE,
        destinationInstanceId: "normal-nexus",
        placements: [{ kind: "card_normal", instanceId: "card-35", amount: 1 }],
        getCardDefinitionById,
      })
    ).toThrow(/cannot provide enter-field cores/);
  });

  it("XX01 自身は通常の場入り維持コア配置先にもできない", () => {
    const state = boardWithGuidedNexus();

    expect(() =>
      applyEnterFieldCorePlacements({
        state,
        actingPlayerId: ALICE,
        destinationInstanceId: "card-35",
        placements: [{ kind: "reserve_normal", amount: 1 }],
        getCardDefinitionById,
      })
    ).toThrow(/Independent-core cards cannot receive enter-field/);
  });

  it("通常スピリット上のコアは通常ネクサス配置の維持コア元にできる", () => {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      cardInstances: [
        createCardInstance(defOf("BSTH04-X02"), {
          instanceId: "normal-spirit",
          ownerPlayerId: ALICE,
          zone: "field",
          cores: 1,
        }),
        createCardInstance(defOf("BSTH01-C12"), {
          instanceId: "normal-nexus",
          ownerPlayerId: ALICE,
          zone: "field",
          cores: 0,
        }),
      ],
    };

    const next = applyEnterFieldCorePlacements({
      state,
      actingPlayerId: ALICE,
      destinationInstanceId: "normal-nexus",
      placements: [
        { kind: "card_normal", instanceId: "normal-spirit", amount: 1 },
      ],
      getCardDefinitionById,
    });

    expect(getCard(next, "normal-spirit").normalCoreCount).toBe(0);
    expect(getCard(next, "normal-nexus").normalCoreCount).toBe(1);
  });
});
