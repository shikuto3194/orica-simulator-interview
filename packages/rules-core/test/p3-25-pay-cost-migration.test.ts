/**
 * P3-25: `Effect.activationCost.payCost` → `pay_cost` cost step + `conditional_cost` 移行検証。
 *
 * 対象カード:
 * - BSTH01-X04 フランドール・スカーレット (Lv1-3 フラッシュ: 1 コスト支払って BP10000 以下相手スピリット 1 体破壊)
 * - BSTH01-M03 森近 霖之助 (召喚時: 1 コスト支払って 幻想スピリット 2 枚を手札へ)
 * - BSTH02-C03 橙 (召喚時: 1 コスト支払って ネクサス 1 枚を手札へ)
 *
 * 検証観点:
 * 1) 各カード effects に `activationCost` が残っていない / cost step が `pay_cost` で始まる
 * 2) リザーブ充足時 → コスト移動 + 後続効果が適用される
 * 3) リザーブ0でもフィールドから支払える。総量不足時のみ conditional_cost をロールバック
 * 4) pay_cost: ソウルコアのフォールバック (通常コア 0 + ソウルコアのみ → ソウルコアで支払う)
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const フランドール = cardNoMap.get("BSTH01-X04");
const 霖之助 = cardNoMap.get("BSTH01-M03");
const 橙 = cardNoMap.get("BSTH02-C03");

describe("P3-25 pay_cost 移行: 構造確認", () => {
  it("BSTH01-X04 effects[0] は pay_cost cost step + conditional_cost", () => {
    const effect = フランドール!.effects![0]!;
    expect(effect.steps[0]?.action.kind).toBe("pay_cost");
    expect(effect.steps[1]?.connector).toBe("conditional_cost");
  });

  it.each([
    [霖之助!, 1],
    [橙!, 0],
  ] as const)("%s: 公開後の二択で pay_cost を使う", (card, index) => {
    const reveal = card.effects![index]!.steps[0]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind !== "deck_reveal") throw new Error("missing reveal");
    expect(reveal.beforePickSteps![0]!.choice![0]!.action).toEqual({
      kind: "pay_cost",
      amount: 1,
    });
  });
});

function buildBattleState(options: {
  reserveCount: number;
  trashCount?: number;
  soulCoreInReserve?: boolean;
}): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      {
        reserveNormalCoreCount: options.reserveCount,
        trashNormalCoreCount: options.trashCount ?? 0,
        ...(options.soulCoreInReserve === false
          ? { soulCoreLocation: { kind: "reserve" as const } }
          : {}),
      },
      {},
    ],
  });
  const target = createCardInstance(フランドール!, {
    instanceId: "enemy-1",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 1,
  });
  const flandre = createCardInstance(フランドール!, {
    instanceId: "flan-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
  });
  return {
    ...base,
    activePlayerId: "alice",
    step: "main",
    cardInstances: [flandre, target],
  };
}

describe("BSTH01-X04 フランドール pay_cost 効果", () => {
  it("リザーブ充足時: 1 コアを支払い、相手 BP10000 以下スピリットを破壊", () => {
    const state = buildBattleState({ reserveCount: 2 });
    const effect = フランドール!.effects![0]!;
    const result = executeEffect({
      chainId: "test:p3-25-pay-cost-migration:97",
      state,
      effect,
      sourceInstanceId: "flan-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(1);
    expect(alice.trashNormalCoreCount).toBe(1);

    const enemy = result.cardInstances.find((c) => c.instanceId === "enemy-1");
    expect(enemy?.pendingLeaveKind).toBe("destroy");
  });

  it("リザーブ0でも標準pay_costは自身のフィールドコアで支払い、破壊する", () => {
    const state = buildBattleState({ reserveCount: 0 });
    const effect = フランドール!.effects![0]!;
    const result = executeEffect({
      chainId: "test:p3-25-pay-cost-migration:116",
      state,
      effect,
      sourceInstanceId: "flan-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.trashNormalCoreCount).toBe(1);

    const enemy = result.cardInstances.find((c) => c.instanceId === "enemy-1");
    expect(enemy?.pendingLeaveKind).toBe("destroy");
    expect(
      result.cardInstances.find((c) => c.instanceId === "flan-1")!
        .normalCoreCount
    ).toBe(0);
  });

  it("リザーブとフィールドの総量不足なら支払いも破壊も成立しない", () => {
    const state = buildBattleState({ reserveCount: 0 });
    const original = フランドール!.effects![0]!;
    const effect = {
      ...original,
      steps: original.steps.map((step) =>
        step.action.kind === "pay_cost"
          ? { ...step, action: { ...step.action, amount: 2 } }
          : step
      ),
    };
    const result = executeEffect({
      chainId: "test:p3-25-pay-cost-insufficient-total",
      state,
      effect,
      sourceInstanceId: "flan-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      result.players.find((p) => p.id === "alice")!.trashNormalCoreCount
    ).toBe(0);
    expect(
      result.cardInstances.find((c) => c.instanceId === "flan-1")!
        .normalCoreCount
    ).toBe(1);
    expect(
      result.cardInstances.find((c) => c.instanceId === "enemy-1")!
        .pendingLeaveKind
    ).toBeNull();
  });
});

describe("pay_cost paymentSources (プレイヤー指定) 経由", () => {
  it("リザーブ 0 + ネクサス上にコア + paymentSources で card 指定 → ネクサスから支払う", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });
    const flandre = createCardInstance(フランドール!, {
      instanceId: "flan-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(フランドール!, {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    // ネクサス相当: コア 2 個保持 (フランドール定義流用、ゾーン = field でコアのみ持たせる)
    const nexus = createCardInstance(フランドール!, {
      instanceId: "nexus-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [flandre, enemy, nexus],
    };

    const effect = フランドール!.effects![0]!;
    const result = executeEffect({
      chainId: "test:p3-25-pay-cost-migration:169",
      state,
      effect,
      sourceInstanceId: "flan-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      payCostPaymentSources: [
        { kind: "card", instanceId: "nexus-1", amount: 1 },
      ],
    });

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.trashNormalCoreCount).toBe(1);

    const nexusAfter = result.cardInstances.find(
      (c) => c.instanceId === "nexus-1"
    );
    expect(nexusAfter?.normalCoreCount).toBe(1);

    const enemyAfter = result.cardInstances.find(
      (c) => c.instanceId === "enemy-1"
    );
    expect(enemyAfter?.pendingLeaveKind).toBe("destroy");
  });

  it("paymentSources の合計が amount と一致しなければ rollback", () => {
    const state = buildBattleState({ reserveCount: 5 });
    const effect = フランドール!.effects![0]!;
    const result = executeEffect({
      chainId: "test:p3-25-pay-cost-migration:198",
      state,
      effect,
      sourceInstanceId: "flan-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      payCostPaymentSources: [{ kind: "reserve", amount: 2 }],
    });

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(5);
    expect(alice.trashNormalCoreCount).toBe(0);

    const enemyAfter = result.cardInstances.find(
      (c) => c.instanceId === "enemy-1"
    );
    expect(enemyAfter?.pendingLeaveKind).toBeNull();
  });

  it("paymentSources でリザーブ指定 → reserve 支払い後に効果実行", () => {
    const state = buildBattleState({ reserveCount: 3 });
    const effect = フランドール!.effects![0]!;
    const result = executeEffect({
      chainId: "test:p3-25-pay-cost-migration:220",
      state,
      effect,
      sourceInstanceId: "flan-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      payCostPaymentSources: [{ kind: "reserve", amount: 1 }],
    });

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(2);
    expect(alice.trashNormalCoreCount).toBe(1);
  });
});

describe("pay_cost ソウルコアフォールバック (paymentSources 未指定)", () => {
  it("通常コア 0 + リザーブ位置のソウルコアのみ → ソウルコアで支払う", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          soulCoreLocation: { kind: "reserve" as const },
        },
        {},
      ],
    });
    const flandre = createCardInstance(フランドール!, {
      instanceId: "flan-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(フランドール!, {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [flandre, enemy],
    };

    const effect = フランドール!.effects![0]!;
    const result = executeEffect({
      chainId: "test:p3-25-pay-cost-migration:269",
      state,
      effect,
      sourceInstanceId: "flan-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.soulCoreLocation?.kind).toBe("trash");
    expect(alice.reserveNormalCoreCount).toBe(0);

    const enemyAfter = result.cardInstances.find(
      (c) => c.instanceId === "enemy-1"
    );
    expect(enemyAfter?.pendingLeaveKind).toBe("destroy");
  });
});
