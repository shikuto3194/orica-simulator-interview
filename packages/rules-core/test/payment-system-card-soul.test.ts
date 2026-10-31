/**
 * フィールドカードからのコスト支払いで、`includeSoulCore: true` を指定した場合に
 * 通常コアではなくソウルコアを 1 個含めて支払えることを検証する。
 *
 * 背景: BattleScreen の「ソウルコア確認」ダイアログで「はい」を押した場合、
 * UI は `{ kind: "card", instanceId, amount, includeSoulCore: true }` を送る。
 * この拡張が無いと normalCoreCount 優先で消費され、ソウルコアが残ってしまう。
 */
import { describe, it, expect } from "vitest";
import {
  applyCardCostPayments,
  createCardInstance,
  createEmptyGameState,
} from "../src";
import { assertPaymentSourcesAreAvailable } from "../src/core/payment-system";
import type { CardDefinition, CardInstance, PlayerState } from "../src";

const ALICE = "player-1";

function dummyDef(cardNo = "TEST-001"): CardDefinition {
  return {
    cardNo,
    name: "Test Card",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    images: {},
    tribe: [],
  } as CardDefinition;
}

function fieldCard(
  instanceId: string,
  cores: number,
  opts: Partial<CardInstance> = {}
): CardInstance {
  return createCardInstance(dummyDef(), {
    instanceId,
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
    ...opts,
  });
}

function getPlayer(
  state: ReturnType<typeof createEmptyGameState>,
  id: string
): PlayerState {
  return state.players.find((p) => p.id === id)!;
}

function getCard(state: ReturnType<typeof createEmptyGameState>, id: string) {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}

describe("applyCardCostPayments — kind:'card' includeSoulCore", () => {
  it("逆転醒由来の ':' を含む instanceId でも利用可能な支払い元として検証できる", () => {
    const instanceId = "card-22:reverse-rebirth:rr-card-22-1750";

    expect(() =>
      assertPaymentSourcesAreAvailable({
        paymentSources: [{ kind: "card", instanceId, amount: 1 }],
        availableReserveCoreAmount: 0,
        availableOnBoardCoreSources: [
          {
            kind: "card",
            instanceId,
            definitionId: "BSTH03-転醒R01(A)",
            zoneRoleName: "nexus",
            availableCoreAmount: 2,
            soulCoreAvailable: false,
          },
        ],
      })
    ).not.toThrow();
  });

  it("通常+ソウル両方が乗っているカードに includeSoulCore:true を指定すると、ソウルが消費され通常コアは1個だけ消費される (amount=2)", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", 2)],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "s1" } },
      ],
    });

    const next = applyCardCostPayments({
      state,
      actingPlayerId: ALICE,
      chainId: "test-chain-1",
      paymentSources: [
        { kind: "card", instanceId: "s1", amount: 2, includeSoulCore: true },
      ],
    });

    const card = getCard(next, "s1");
    const player = getPlayer(next, ALICE);

    // 通常コア: 2 → 1（1個だけ消費）
    expect(card.normalCoreCount).toBe(1);
    // ソウルコア: カードから外れる
    expect(player.soulCoreLocation).toEqual({ kind: "trash" });
    // トラッシュ: 通常 1 + ソウルなのでカウントは 1 (soul は別扱い)
    expect(player.trashNormalCoreCount).toBe(1);
  });

  it("includeSoulCore:true で amount=1 の場合は通常コアを消費せずソウルだけ消費する", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", 2)],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "s1" } },
      ],
    });

    const next = applyCardCostPayments({
      state,
      actingPlayerId: ALICE,
      chainId: "test-chain-2",
      paymentSources: [
        { kind: "card", instanceId: "s1", amount: 1, includeSoulCore: true },
      ],
    });

    const card = getCard(next, "s1");
    const player = getPlayer(next, ALICE);

    expect(card.normalCoreCount).toBe(2);
    expect(player.soulCoreLocation).toEqual({ kind: "trash" });
  });

  it("includeSoulCore:true でソウルが乗っていないカードに指定するとエラー", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", 2)],
    });

    expect(() =>
      applyCardCostPayments({
        state,
        actingPlayerId: ALICE,
        chainId: "test-chain-3",
        paymentSources: [
          { kind: "card", instanceId: "s1", amount: 1, includeSoulCore: true },
        ],
      })
    ).toThrow(/Soul core is not on payment card/);
  });

  it("includeSoulCore 未指定 (従来動作) では通常コア優先で消費される", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", 2)],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "s1" } },
      ],
    });

    const next = applyCardCostPayments({
      state,
      actingPlayerId: ALICE,
      chainId: "test-chain-4",
      paymentSources: [{ kind: "card", instanceId: "s1", amount: 2 }],
    });

    const card = getCard(next, "s1");
    const player = getPlayer(next, ALICE);

    // 通常2個消費、ソウルは残る
    expect(card.normalCoreCount).toBe(0);
    expect(player.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "s1",
    });
  });
});
