/** per_trigger_activation の汎用使用制限。実カードの発揮監視とは独立に検証する。 */
import { describe, expect, it } from "vitest";
import { createEmptyGameState, type GameState } from "../src";
import {
  canUseEffectUsage,
  listEffectUsage,
  seedEffectUsage,
} from "./helpers/effect-usage-fixture";

function baseState(): GameState {
  return {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    activePlayerId: "alice",
    step: "attack",
    turnNumber: 3,
  };
}

/** 発揮元個体が state に無いため、使用者と定義IDを明示する。 */
const SITE = {
  sourceDefinitionId: "TEST-ACTIVATION-LISTENER",
  playerId: "alice",
};

/** 使用回数の枠が束ねている「同一効果発揮由来」識別子 (期間ID) の集合。 */
function activationPeriods(state: GameState): string[] {
  return listEffectUsage(state).map((entry) => entry.periodId);
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
      canUseEffectUsage(state, {
        ...SITE,
        sourceInstanceId: "listener-src",
        effectLabel: "effect:1",
        usageLimit: LIMIT,
        triggerActivationKey: "chain-A",
      })
    ).toBe(true);
    state = seedEffectUsage(state, {
      ...SITE,
      sourceInstanceId: "listener-src",
      effectLabel: "effect:1",
      usageLimit: LIMIT,
      triggerActivationKey: "chain-A",
    });

    // 2 回目: 同 chainId → 封鎖。これが本 primitive の core 検証。
    expect(
      canUseEffectUsage(state, {
        ...SITE,
        sourceInstanceId: "listener-src",
        effectLabel: "effect:1",
        usageLimit: LIMIT,
        triggerActivationKey: "chain-A",
      })
    ).toBe(false);

    // record は 1 件のみ (count=1)。
    const records = listEffectUsage(state).filter(
      (r) => r.label === "effect:1"
    );
    expect(records).toHaveLength(1);
    expect(records[0]!.amount).toBe(1);
    expect(activationPeriods(state)).toEqual(["activation:chain-A"]);
  });

  it(`${CARD_REF} 異なる破壊効果 activation (= 別 chainId) は独立に発揮可能`, () => {
    let state = baseState();
    state = seedEffectUsage(state, {
      ...SITE,
      sourceInstanceId: "listener-src",
      effectLabel: "effect:1",
      usageLimit: LIMIT,
      triggerActivationKey: "chain-A",
    });

    // chain-B (別 activation) は独立に許可される。
    expect(
      canUseEffectUsage(state, {
        ...SITE,
        sourceInstanceId: "listener-src",
        effectLabel: "effect:1",
        usageLimit: LIMIT,
        triggerActivationKey: "chain-B",
      })
    ).toBe(true);

    state = seedEffectUsage(state, {
      ...SITE,
      sourceInstanceId: "listener-src",
      effectLabel: "effect:1",
      usageLimit: LIMIT,
      triggerActivationKey: "chain-B",
    });
    const records = listEffectUsage(state).filter(
      (r) => r.label === "effect:1"
    );
    expect(records).toHaveLength(2);
    expect(new Set(activationPeriods(state))).toEqual(
      new Set(["activation:chain-A", "activation:chain-B"])
    );
  });

  it(`${CARD_REF} triggerActivationKey 未指定 (legacy 経路) は単独スロット`, () => {
    let state = baseState();
    // chainId のない record (state-based 由来等)。
    state = seedEffectUsage(state, {
      ...SITE,
      sourceInstanceId: "listener-src",
      effectLabel: "effect:1",
      usageLimit: LIMIT,
      // triggerActivationKey 未指定
    });

    // 同じ未指定で 2 回目: legacy per_instance 同様の挙動 (totalCount=1 >= maxCount=1 → blocked)。
    expect(
      canUseEffectUsage(state, {
        ...SITE,
        sourceInstanceId: "listener-src",
        effectLabel: "effect:1",
        usageLimit: LIMIT,
      })
    ).toBe(false);

    // 別 chainId で許可される (legacy 単独スロットとは独立)。
    expect(
      canUseEffectUsage(state, {
        ...SITE,
        sourceInstanceId: "listener-src",
        effectLabel: "effect:1",
        usageLimit: LIMIT,
        triggerActivationKey: "chain-A",
      })
    ).toBe(true);
  });

  it(`${CARD_REF} 別 sourceInstanceId は同 chainId でも独立 (listener 主体別)`, () => {
    let state = baseState();
    // 同 chain で listener-A は記録済。
    state = seedEffectUsage(state, {
      ...SITE,
      sourceInstanceId: "listener-A",
      effectLabel: "effect:1",
      usageLimit: LIMIT,
      triggerActivationKey: "chain-A",
    });

    // 別 listener (別 instance) は同 chain でも独立発揮可能。
    expect(
      canUseEffectUsage(state, {
        ...SITE,
        sourceInstanceId: "listener-B",
        effectLabel: "effect:1",
        usageLimit: LIMIT,
        triggerActivationKey: "chain-A",
      })
    ).toBe(true);
  });
});
