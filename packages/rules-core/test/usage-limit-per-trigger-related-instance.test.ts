/**
 * `per_trigger_related_instance` 用 UsageLimit プリミティブ。
 *
 * BSTH05-X02 effects[1]「ターンに1回ずつ回復できる」のように、観測トリガー
 * 主語 Y 別に独立した turn 1 回制限を表現する。
 * 記録キー = (sourceInstanceId, effectLabel, relatedInstanceId)。
 *
 * - Y が異なれば独立に発揮可能
 * - 同じ Y への 2 回目は封鎖される
 * - relatedInstanceId 未指定でも他 Y の記録に巻き込まれない (Y=undefined 単独レコード)
 * - turn duration が変われば clearExpiredEffectUsageRecords でリセットされる
 * - refundEffectUsageIfRecorded は relatedInstanceId 指定があれば対応レコードのみ取り消す
 */
import { describe, expect, it } from "vitest";
import { createEmptyGameState, type GameState } from "../src";
import {
  canUseEffectByUsageLimit,
  clearExpiredEffectUsageRecords,
  recordEffectUsageIfLimited,
  refundEffectUsageIfRecorded,
} from "../src/legal/legal-actions-shared";

function baseState(): GameState {
  return {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    activePlayerId: "alice",
    step: "attack",
    turnNumber: 5,
  };
}

const LIMIT = {
  kind: "per_trigger_related_instance" as const,
  duration: "turn" as const,
};

describe("per_trigger_related_instance usageLimit", () => {
  it("different Y can each fire once per turn", () => {
    let state = baseState();

    // alice-source declares its effect for Y=spirit-1
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "alice-source",
        sourceDefinitionId: "TEST",
        effectLabel: "effect:0",
        usageLimit: LIMIT,
        relatedInstanceId: "spirit-1",
      })
    ).toBe(true);
    state = recordEffectUsageIfLimited({
      state,
      sourceInstanceId: "alice-source",
      sourceDefinitionId: "TEST",
      effectLabel: "effect:0",
      usageLimit: LIMIT,
      relatedInstanceId: "spirit-1",
    });

    // Same Y -> blocked
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "alice-source",
        sourceDefinitionId: "TEST",
        effectLabel: "effect:0",
        usageLimit: LIMIT,
        relatedInstanceId: "spirit-1",
      })
    ).toBe(false);

    // Different Y -> still allowed
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "alice-source",
        sourceDefinitionId: "TEST",
        effectLabel: "effect:0",
        usageLimit: LIMIT,
        relatedInstanceId: "spirit-2",
      })
    ).toBe(true);

    state = recordEffectUsageIfLimited({
      state,
      sourceInstanceId: "alice-source",
      sourceDefinitionId: "TEST",
      effectLabel: "effect:0",
      usageLimit: LIMIT,
      relatedInstanceId: "spirit-2",
    });
    // Y=spirit-1 と Y=spirit-2 の 2 レコード
    expect(
      state.effectUsageRecords.filter((r) => r.effectLabel === "effect:0")
    ).toHaveLength(2);
  });

  it("undefined Y is its own slot (does not conflict with concrete Y)", () => {
    let state = baseState();
    state = recordEffectUsageIfLimited({
      state,
      sourceInstanceId: "alice-source",
      sourceDefinitionId: "TEST",
      effectLabel: "effect:0",
      usageLimit: LIMIT,
      relatedInstanceId: "spirit-1",
    });

    // undefined Y は独立スロット (concrete Y のレコードに巻き込まれない)
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "alice-source",
        sourceDefinitionId: "TEST",
        effectLabel: "effect:0",
        usageLimit: LIMIT,
      })
    ).toBe(true);
  });

  it("turn change resets the limit (clearExpiredEffectUsageRecords)", () => {
    let state = baseState();
    state = recordEffectUsageIfLimited({
      state,
      sourceInstanceId: "alice-source",
      sourceDefinitionId: "TEST",
      effectLabel: "effect:0",
      usageLimit: LIMIT,
      relatedInstanceId: "spirit-1",
    });
    expect(state.effectUsageRecords).toHaveLength(1);

    const nextTurn: GameState = { ...state, turnNumber: 6 };
    const cleaned = clearExpiredEffectUsageRecords(nextTurn);
    expect(cleaned).toHaveLength(0);
  });

  it("refund only undoes the matching Y record when relatedInstanceId is passed", () => {
    let state = baseState();
    state = recordEffectUsageIfLimited({
      state,
      sourceInstanceId: "alice-source",
      sourceDefinitionId: "TEST",
      effectLabel: "effect:0",
      usageLimit: LIMIT,
      relatedInstanceId: "spirit-1",
    });
    state = recordEffectUsageIfLimited({
      state,
      sourceInstanceId: "alice-source",
      sourceDefinitionId: "TEST",
      effectLabel: "effect:0",
      usageLimit: LIMIT,
      relatedInstanceId: "spirit-2",
    });
    expect(state.effectUsageRecords).toHaveLength(2);

    state = refundEffectUsageIfRecorded({
      state,
      sourceInstanceId: "alice-source",
      effectLabel: "effect:0",
      usageLimit: LIMIT,
      relatedInstanceId: "spirit-1",
    });
    // spirit-1 のレコードのみ消える。spirit-2 は残る。
    expect(state.effectUsageRecords).toHaveLength(1);
    expect(state.effectUsageRecords[0]!.relatedInstanceId).toBe("spirit-2");
  });

  it("array usageLimit with mixed kinds keeps per-Y semantics intact", () => {
    // [per_trigger_related_instance + no_duplicate] の併存 (BSTH05-X02 想定)
    const arrLimit = [LIMIT, { kind: "no_duplicate" as const }];
    let state = baseState();

    // Y=spirit-1 で記録
    state = recordEffectUsageIfLimited({
      state,
      sourceInstanceId: "alice-source",
      sourceDefinitionId: "TEST",
      effectLabel: "effect:0",
      usageLimit: arrLimit,
      relatedInstanceId: "spirit-1",
    });

    // per_trigger 側は Y=spirit-2 で OK
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "alice-source",
        sourceDefinitionId: "TEST",
        effectLabel: "effect:0",
        usageLimit: LIMIT,
        relatedInstanceId: "spirit-2",
      })
    ).toBe(true);
    // 一方 no_duplicate 側は同 definition で既使用 → 封鎖
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "alice-source",
        sourceDefinitionId: "TEST",
        effectLabel: "effect:0",
        usageLimit: { kind: "no_duplicate" },
      })
    ).toBe(false);
  });
});
