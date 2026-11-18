/**
 * `per_trigger_related_instance` 用 UsageLimit プリミティブ。
 *
 * BSTH05-X02 effects[1]「ターンに1回ずつ回復できる」のように、観測トリガー
 * 主語 Y 別に独立した turn 1 回制限を表現する。
 * 使用枠の識別 = (sourceInstanceId, effectLabel, relatedInstanceId)。
 *
 * - Y が異なれば独立に発揮可能
 * - 同じ Y への 2 回目は封鎖される
 * - relatedInstanceId 未指定でも他 Y の記録に巻き込まれない (Y=undefined 単独レコード)
 * - turn duration が変われば (次ターンでは) 使用枠が再び使える
 * - 使用の取り消し (refund) は relatedInstanceId 指定があれば対応する枠のみ取り消す
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
} from "../src";
import {
  canUseEffectUsage,
  effectUsageEntryCount,
  listEffectUsage,
  refundEffectUsageForTest,
  seedEffectUsage,
} from "./helpers/effect-usage-fixture";

const SOURCE_DEF: CardDefinition = {
  cardNo: "TEST",
  name: "テスト発揮元",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  tribe: "テスト",
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
} as CardDefinition;

function baseState(): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(SOURCE_DEF, {
          instanceId: "alice-source",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    }),
    activePlayerId: "alice",
    step: "attack",
    turnNumber: 5,
  };
}

/** 発揮元・効果ラベルを固定した呼出し引数。 */
function usage(
  usageLimit: Parameters<typeof seedEffectUsage>[1]["usageLimit"],
  relatedInstanceId?: string
) {
  return {
    sourceInstanceId: "alice-source",
    sourceDefinitionId: "TEST",
    effectLabel: "effect:0",
    usageLimit,
    ...(relatedInstanceId !== undefined ? { relatedInstanceId } : {}),
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
    expect(canUseEffectUsage(state, usage(LIMIT, "spirit-1"))).toBe(true);
    state = seedEffectUsage(state, usage(LIMIT, "spirit-1"));

    // Same Y -> blocked
    expect(canUseEffectUsage(state, usage(LIMIT, "spirit-1"))).toBe(false);

    // Different Y -> still allowed
    expect(canUseEffectUsage(state, usage(LIMIT, "spirit-2"))).toBe(true);

    state = seedEffectUsage(state, usage(LIMIT, "spirit-2"));
    // Y=spirit-1 と Y=spirit-2 の 2 枠
    expect(
      listEffectUsage(state).filter((entry) => entry.label === "effect:0")
    ).toHaveLength(2);
  });

  it("undefined Y is its own slot (does not conflict with concrete Y)", () => {
    let state = baseState();
    state = seedEffectUsage(state, usage(LIMIT, "spirit-1"));

    // undefined Y は独立スロット (concrete Y のレコードに巻き込まれない)
    expect(canUseEffectUsage(state, usage(LIMIT))).toBe(true);
  });

  it("turn change resets the limit", () => {
    let state = baseState();
    state = seedEffectUsage(state, usage(LIMIT, "spirit-1"));
    expect(effectUsageEntryCount(state)).toBe(1);
    expect(canUseEffectUsage(state, usage(LIMIT, "spirit-1"))).toBe(false);

    // 次ターンでは turn 期間の枠が生存せず、同じ Y でも再び使用できる。
    const nextTurn: GameState = { ...state, turnNumber: 6 };
    expect(canUseEffectUsage(nextTurn, usage(LIMIT, "spirit-1"))).toBe(true);
  });

  it("refund only undoes the matching Y record when relatedInstanceId is passed", () => {
    let state = baseState();
    state = seedEffectUsage(state, usage(LIMIT, "spirit-1"));
    state = seedEffectUsage(state, usage(LIMIT, "spirit-2"));
    expect(effectUsageEntryCount(state)).toBe(2);

    state = refundEffectUsageForTest(state, usage(LIMIT, "spirit-1"));
    // spirit-1 の使用のみ取り消される。spirit-2 は残る。
    expect(canUseEffectUsage(state, usage(LIMIT, "spirit-1"))).toBe(true);
    expect(canUseEffectUsage(state, usage(LIMIT, "spirit-2"))).toBe(false);
    expect(
      listEffectUsage(state).filter((entry) => entry.amount > 0)
    ).toHaveLength(1);
  });

  it("array usageLimit with mixed kinds keeps per-Y semantics intact", () => {
    // [per_trigger_related_instance + no_duplicate] の併存 (BSTH05-X02 想定)
    const arrLimit = [LIMIT, { kind: "no_duplicate" as const }];
    let state = baseState();

    // Y=spirit-1 で記録
    state = seedEffectUsage(state, usage(arrLimit, "spirit-1"));

    // per_trigger 側は Y=spirit-2 で OK
    expect(canUseEffectUsage(state, usage(LIMIT, "spirit-2"))).toBe(true);
    // 一方 no_duplicate 側は同 definition で既使用 → 封鎖
    expect(canUseEffectUsage(state, usage({ kind: "no_duplicate" }))).toBe(
      false
    );
  });
});
