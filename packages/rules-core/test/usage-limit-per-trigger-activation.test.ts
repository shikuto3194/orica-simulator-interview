/** per_trigger_activation の汎用使用制限。実カードの発揮監視とは独立に検証する。 */
import { describe, expect, it } from "vitest";
import { createEmptyGameState, type GameState } from "../src";
import {
  canUseEffectByUsageLimit,
  recordEffectUsageIfLimited,
} from "../src/legal/legal-actions-shared";

function baseState(): GameState {
  return {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    activePlayerId: "alice",
    step: "attack",
    turnNumber: 3,
  };
}

const LIMIT = {
  kind: "per_trigger_activation" as const,
  duration: "turn" as const,
};

describe("per_trigger_activation usageLimit (ENGINE-trigger-per-effect-activation-dedup)", () => {
  const CARD_REF = "TEST-ACTIVATION-LISTENER";

  it(`${CARD_REF} 1 破壊効果が複数体破壊 → 同 chainId の 2 回目は封鎖 (dedup)`, () => {
    let state = baseState();

    // 1 破壊効果由来の同 chainId で 2 回 emit される想定 (per-card emit)。
    // 1 回目: listener 発火可。
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "listener-src",
        sourceDefinitionId: CARD_REF,
        effectLabel: "effect:1",
        usageLimit: LIMIT,
        triggerActivationKey: "chain-A",
      })
    ).toBe(true);
    state = recordEffectUsageIfLimited({
      state,
      sourceInstanceId: "listener-src",
      sourceDefinitionId: CARD_REF,
      effectLabel: "effect:1",
      usageLimit: LIMIT,
      triggerActivationKey: "chain-A",
    });

    // 2 回目: 同 chainId → 封鎖。これが本 primitive の core 検証。
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "listener-src",
        sourceDefinitionId: CARD_REF,
        effectLabel: "effect:1",
        usageLimit: LIMIT,
        triggerActivationKey: "chain-A",
      })
    ).toBe(false);

    // record は 1 件のみ (count=1)。
    const records = state.effectUsageRecords.filter(
      (r) => r.effectLabel === "effect:1"
    );
    expect(records).toHaveLength(1);
    expect(records[0]!.count).toBe(1);
    expect(records[0]!.triggerActivationKey).toBe("chain-A");
  });

  it(`${CARD_REF} 異なる破壊効果 activation (= 別 chainId) は独立に発揮可能`, () => {
    let state = baseState();
    state = recordEffectUsageIfLimited({
      state,
      sourceInstanceId: "listener-src",
      sourceDefinitionId: CARD_REF,
      effectLabel: "effect:1",
      usageLimit: LIMIT,
      triggerActivationKey: "chain-A",
    });

    // chain-B (別 activation) は独立に許可される。
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "listener-src",
        sourceDefinitionId: CARD_REF,
        effectLabel: "effect:1",
        usageLimit: LIMIT,
        triggerActivationKey: "chain-B",
      })
    ).toBe(true);

    state = recordEffectUsageIfLimited({
      state,
      sourceInstanceId: "listener-src",
      sourceDefinitionId: CARD_REF,
      effectLabel: "effect:1",
      usageLimit: LIMIT,
      triggerActivationKey: "chain-B",
    });
    const records = state.effectUsageRecords.filter(
      (r) => r.effectLabel === "effect:1"
    );
    expect(records).toHaveLength(2);
    expect(new Set(records.map((r) => r.triggerActivationKey))).toEqual(
      new Set(["chain-A", "chain-B"])
    );
  });

  it(`${CARD_REF} triggerActivationKey 未指定 (legacy 経路) は単独スロット`, () => {
    let state = baseState();
    // chainId のない record (state-based 由来等)。
    state = recordEffectUsageIfLimited({
      state,
      sourceInstanceId: "listener-src",
      sourceDefinitionId: CARD_REF,
      effectLabel: "effect:1",
      usageLimit: LIMIT,
      // triggerActivationKey 未指定
    });

    // 同じ未指定で 2 回目: legacy per_instance 同様の挙動 (totalCount=1 >= maxCount=1 → blocked)。
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "listener-src",
        sourceDefinitionId: CARD_REF,
        effectLabel: "effect:1",
        usageLimit: LIMIT,
      })
    ).toBe(false);

    // 別 chainId で許可される (legacy 単独スロットとは独立)。
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "listener-src",
        sourceDefinitionId: CARD_REF,
        effectLabel: "effect:1",
        usageLimit: LIMIT,
        triggerActivationKey: "chain-A",
      })
    ).toBe(true);
  });

  it(`${CARD_REF} 別 sourceInstanceId は同 chainId でも独立 (listener 主体別)`, () => {
    let state = baseState();
    // 同 chain で listener-A は記録済。
    state = recordEffectUsageIfLimited({
      state,
      sourceInstanceId: "listener-A",
      sourceDefinitionId: CARD_REF,
      effectLabel: "effect:1",
      usageLimit: LIMIT,
      triggerActivationKey: "chain-A",
    });

    // 別 listener (別 instance) は同 chain でも独立発揮可能。
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "listener-B",
        sourceDefinitionId: CARD_REF,
        effectLabel: "effect:1",
        usageLimit: LIMIT,
        triggerActivationKey: "chain-A",
      })
    ).toBe(true);
  });
});
