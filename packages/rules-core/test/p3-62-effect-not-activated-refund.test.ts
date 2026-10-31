/**
 * P3-62: 「発揮できない」効果の usageLimit / ▶コスト 払い戻し。
 *
 * 公式裁定:
 * - page14 一般則: 「解決の順番により、発揮のための条件を満たさなくなっていた場合、
 *   その効果は発揮できません」
 * - 効果全般 Q5: 「○○することで△△する」 — △△できないときに○○だけすることも
 *   できません。
 * - Q31523 (起動): ▶以降が完全に解決できない場合、効果全体を発揮できない。
 *
 * 修正対象:
 * - ケース 2: condition (「のとき」) が解決時に false → usageLimit 消費しない。
 * - ケース 4: ▶コスト効果 (conditional_cost connector) の △△ が無対象 →
 *   cost も含めて全体ロールバック + usageLimit 消費しない。
 */
import { describe, expect, it } from "vitest";
import {
  createEmptyGameState,
  executeEffect,
  recordEffectUsageIfLimited,
  refundEffectUsage,
  refundEffectUsageIfRecorded,
} from "../src";
import { refundAllRecordedUsage } from "../src/effect/native-effect-front-helpers";
import type {
  CardDefinition,
  EffectUsageLimit,
  EffectUsageRecord,
  GameState,
} from "../src";
import type { Effect } from "../src/dsl-types";

function buildState(): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    turnNumber: 1,
    activePlayerId: "alice",
    step: "main",
  };
}

const dummyCard: CardDefinition = {
  cardNo: "TEST-001",
  name: "テストカード",
  printedCategory: "magic",
  category: "magic",
  cost: 1,
  reduction: { red: 0, purple: 0, green: 0, white: 0, blue: 0, yellow: 0 },
  symbols: [],
  color: ["red"],
  level: [],
  bp: [],
  tribe: "",
  textLines: [],
  effects: [],
  image: "",
  rarity: "C",
  pack: "TEST",
  maxDeckCount: 4,
  sourceUrls: [],
  sourceConfidence: "C",
};

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  id === dummyCard.cardNo ? dummyCard : undefined;
const triggerLookup = () => undefined;

const turnLimit: EffectUsageLimit = {
  kind: "per_instance",
  duration: "turn",
};

const noDuplicateLimit: EffectUsageLimit = {
  kind: "no_duplicate",
};

describe("P3-62 refund primitives", () => {
  it("refundEffectUsage: count > 1 のとき 1 件減算", () => {
    const state: GameState = {
      ...buildState(),
      effectUsageRecords: [
        {
          sourceInstanceId: "src-1",
          sourceDefinitionId: "TEST-001",
          effectLabel: "magic",
          turnNumber: 1,
          step: "main",
          duration: "turn",
          count: 2,
        },
      ],
    };
    const next = refundEffectUsage({
      state,
      sourceInstanceId: "src-1",
      effectLabel: "magic",
      duration: "turn",
    });
    expect(next).toHaveLength(1);
    expect(next[0]!.count).toBe(1);
  });

  it("refundEffectUsage: count === 1 のときレコード除去", () => {
    const state: GameState = {
      ...buildState(),
      effectUsageRecords: [
        {
          sourceInstanceId: "src-1",
          sourceDefinitionId: "TEST-001",
          effectLabel: "magic",
          turnNumber: 1,
          step: "main",
          duration: "turn",
          count: 1,
        },
      ],
    };
    const next = refundEffectUsage({
      state,
      sourceInstanceId: "src-1",
      effectLabel: "magic",
      duration: "turn",
    });
    expect(next).toHaveLength(0);
  });

  it("refundEffectUsage: 不一致レコードは保持 (idempotent)", () => {
    const records: EffectUsageRecord[] = [
      {
        sourceInstanceId: "other-src",
        sourceDefinitionId: "TEST-002",
        effectLabel: "magic",
        turnNumber: 1,
        step: "main",
        duration: "turn",
        count: 1,
      },
    ];
    const state: GameState = { ...buildState(), effectUsageRecords: records };
    const next = refundEffectUsage({
      state,
      sourceInstanceId: "src-1",
      effectLabel: "magic",
      duration: "turn",
    });
    expect(next).toEqual(records);
  });

  it("refundEffectUsageIfRecorded: record → refund で残レコード 0", () => {
    let state = buildState();
    state = recordEffectUsageIfLimited({
      state,
      sourceInstanceId: "src-1",
      sourceDefinitionId: "TEST-001",
      effectLabel: "magic",
      usageLimit: turnLimit,
    });
    expect(state.effectUsageRecords).toHaveLength(1);

    state = refundEffectUsageIfRecorded({
      state,
      sourceInstanceId: "src-1",
      effectLabel: "magic",
      usageLimit: turnLimit,
    });
    expect(state.effectUsageRecords).toHaveLength(0);
  });

  it("refundEffectUsageIfRecorded: usageLimit undefined → no-op", () => {
    const state = buildState();
    const next = refundEffectUsageIfRecorded({
      state,
      sourceInstanceId: "src-1",
      effectLabel: "magic",
      usageLimit: undefined,
    });
    expect(next).toBe(state);
  });

  it("refundEffectUsageIfRecorded: no_duplicate は triggerEventScopeKey が一致した record だけ refund", () => {
    const state: GameState = {
      ...buildState(),
      step: "attack",
      effectUsageRecords: [
        {
          sourceInstanceId: "src-1",
          sourceDefinitionId: "TEST-001",
          effectLabel: "attack",
          turnNumber: 1,
          step: "attack",
          duration: "turn",
          count: 1,
          triggerEventScopeKey: "attack-event:1",
        },
        {
          sourceInstanceId: "src-1",
          sourceDefinitionId: "TEST-001",
          effectLabel: "attack",
          turnNumber: 1,
          step: "attack",
          duration: "turn",
          count: 1,
          triggerEventScopeKey: "attack-event:2",
        },
      ],
    };

    const next = refundEffectUsageIfRecorded({
      state,
      sourceInstanceId: "src-1",
      effectLabel: "attack",
      usageLimit: noDuplicateLimit,
      triggerEventScopeKey: "attack-event:2",
    });

    expect(next.effectUsageRecords).toEqual([
      expect.objectContaining({ triggerEventScopeKey: "attack-event:1" }),
    ]);
  });

  it("refundAllRecordedUsage: recordedUsage の sourceInstanceId で under-card 記録を refund", () => {
    const state: GameState = {
      ...buildState(),
      step: "attack",
      effectUsageRecords: [
        {
          sourceInstanceId: "under-card-1",
          sourceDefinitionId: "BSFT01-TR01",
          effectLabel: "attack",
          turnNumber: 1,
          step: "attack",
          duration: "turn",
          count: 1,
          triggerEventScopeKey: "battle_immediate:attack-1:attack:tr01:0",
        },
      ],
    };

    const next = refundAllRecordedUsage(state, "host-spirit-1", {
      sourceInstanceId: "under-card-1",
      effectLabel: "attack",
      usageLimit: noDuplicateLimit,
      triggerEventScopeKey: "battle_immediate:attack-1:attack:tr01:0",
    });

    expect(next.effectUsageRecords).toHaveLength(0);
  });
});

describe("P3-62 ケース 2: condition unmet → executeEffect が refund", () => {
  it("condition unmet で recordedUsage を refund する", () => {
    // 効果: 「自分のライフが3以下のとき、ターンに1回 ライフを1回復」
    // 宣言時点でライフが 3 だったが解決時 (executeEffect) では 4 に増えている → 発揮不能。
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      condition: [
        {
          kind: "count_value",
          player: "self",
          max: 3,
        },
      ],
      usageLimit: turnLimit,
      steps: [
        {
          action: {
            kind: "life_fill",
            player: "self",
            amount: 1,
          },
        },
      ],
    };

    // 宣言時 (life=3) → 記録
    let state: GameState = {
      ...buildState(),
      effectUsageRecords: [
        {
          sourceInstanceId: "src-1",
          sourceDefinitionId: "TEST-001",
          effectLabel: "magic",
          turnNumber: 1,
          step: "main",
          duration: "turn",
          count: 1,
        },
      ],
      // life は不問 (condition は countValue 比較なので countValue を 4 にして false 化)
      players: buildState().players.map((p) =>
        p.id === "alice" ? { ...p, countValue: 4 } : p
      ),
    };

    state = executeEffect({
      chainId: "test:p3-62-effect-not-activated-refund:296",
      state,
      effect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggerLookup,
      recordedUsage: {
        effectLabel: "magic",
        usageLimit: turnLimit,
      },
    });

    expect(state.log.some((l) => l.startsWith("effect:condition-unmet:"))).toBe(
      true
    );
    // P3-62: refund されレコード除去
    expect(state.effectUsageRecords).toHaveLength(0);
  });

  it("recordedUsage 未指定なら refund しない (後方互換)", () => {
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      condition: [
        {
          kind: "count_value",
          player: "self",
          max: 3,
        },
      ],
      usageLimit: turnLimit,
      steps: [
        {
          action: { kind: "life_fill", player: "self", amount: 1 },
        },
      ],
    };
    const records: EffectUsageRecord[] = [
      {
        sourceInstanceId: "src-1",
        sourceDefinitionId: "TEST-001",
        effectLabel: "magic",
        turnNumber: 1,
        step: "main",
        duration: "turn",
        count: 1,
      },
    ];
    let state: GameState = {
      ...buildState(),
      effectUsageRecords: records,
      players: buildState().players.map((p) =>
        p.id === "alice" ? { ...p, countValue: 4 } : p
      ),
    };
    state = executeEffect({
      chainId: "test:p3-62-effect-not-activated-refund:351",
      state,
      effect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    expect(state.effectUsageRecords).toEqual(records);
  });
});

describe("P3-62 ケース 4: conditional_cost rollback で refund + 状態巻き戻し", () => {
  it("effect step (△△) が succeeded=false → cost step (○○) もロールバック + refund", () => {
    // 効果: 「count を 1 減らすことで、count を 1 増やす」 (テスト用の simplified ▶コスト)。
    // alice の countValue を 5 から始める。
    // step0: count_decrease (cost) → 4 になる (成功)
    // step1: count_set value=5 → 既に 5 ではない (現在 4) なので set 自体は成功するが、
    //        ここでは別の「失敗するアクション」を用意して △△ 失敗を再現する。
    //
    // より単純な構造: step0 cost: count_decrease, step1 effect: bp_modify with no targets
    // → 対象 0 件で succeeded=false → rollback。
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      usageLimit: turnLimit,
      steps: [
        {
          id: "cost",
          action: {
            kind: "count_decrease",
            player: "self",
            amount: 1,
          },
        },
        {
          id: "effect",
          action: {
            kind: "bp_modify",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
            amount: 1000,
            duration: { scope: "turn" },
          },
          connector: "conditional_cost",
        },
      ],
    };

    let state: GameState = {
      ...buildState(),
      effectUsageRecords: [
        {
          sourceInstanceId: "src-1",
          sourceDefinitionId: "TEST-001",
          effectLabel: "magic",
          turnNumber: 1,
          step: "main",
          duration: "turn",
          count: 1,
        },
      ],
      players: buildState().players.map((p) =>
        p.id === "alice" ? { ...p, countValue: 5 } : p
      ),
    };

    const aliceBeforeCount = state.players.find(
      (p) => p.id === "alice"
    )!.countValue;

    state = executeEffect({
      chainId: "test:p3-62-effect-not-activated-refund:425",
      state,
      effect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggerLookup,
      recordedUsage: {
        effectLabel: "magic",
        usageLimit: turnLimit,
      },
    });

    // 状態巻き戻し: count は cost 支払前 (5) に戻る
    const aliceAfterCount = state.players.find(
      (p) => p.id === "alice"
    )!.countValue;
    expect(aliceAfterCount).toBe(aliceBeforeCount);

    // refund: レコード除去
    expect(state.effectUsageRecords).toHaveLength(0);

    // ログ: conditional-cost-effect-failed が積まれる
    expect(
      state.log.some((l) =>
        l.startsWith("effect:conditional-cost-effect-failed:")
      )
    ).toBe(true);
  });

  it("cost step (○○) 失敗 (count 不足) → rollback + refund", () => {
    // count = 0 で count_decrease (cost) を試行 → 0 のまま (succeeded=false)
    // → 既存の cost-fail rollback + 新規 refund 両方が発火
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      usageLimit: turnLimit,
      steps: [
        {
          id: "cost",
          action: {
            kind: "count_decrease",
            player: "self",
            amount: 1,
          },
        },
        {
          id: "effect",
          action: {
            kind: "life_fill",
            player: "self",
            amount: 1,
          },
          connector: "conditional_cost",
        },
      ],
    };

    let state: GameState = {
      ...buildState(),
      effectUsageRecords: [
        {
          sourceInstanceId: "src-1",
          sourceDefinitionId: "TEST-001",
          effectLabel: "magic",
          turnNumber: 1,
          step: "main",
          duration: "turn",
          count: 1,
        },
      ],
      players: buildState().players.map((p) =>
        p.id === "alice" ? { ...p, countValue: 0 } : p
      ),
    };

    state = executeEffect({
      chainId: "test:p3-62-effect-not-activated-refund:500",
      state,
      effect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggerLookup,
      recordedUsage: {
        effectLabel: "magic",
        usageLimit: turnLimit,
      },
    });

    // refund: コスト払えなかったので usageLimit も消費しない
    expect(state.effectUsageRecords).toHaveLength(0);
    // count は 0 のまま (rollback 後)
    expect(state.players.find((p) => p.id === "alice")!.countValue).toBe(0);
  });
});

describe("P3-62 ケース5 (choice variant condition unmet → refund, BSTH02.7-C02 verifier指摘)", () => {
  function buildChoiceEffect(): Effect {
    return {
      timing: { kind: "activated", mode: "flash" },
      usageLimit: turnLimit,
      steps: [
        {
          id: "mode",
          action: { kind: "life_fill", player: "self", targetValue: 2 },
          choice: [
            {
              action: { kind: "life_fill", player: "self", targetValue: 5 },
              condition: [
                {
                  kind: "count_value",
                  player: "self",
                  min: 5,
                },
              ],
            },
          ],
        },
      ],
    };
  }

  it("choice variant の condition が解決時 false → 何も実行せず recordedUsage を refund する", () => {
    // 宣言時に choice[0] (variant, count_value min:5 条件付き) を選んだが、
    // 解決時には countValue=1 で条件不成立 → step 全体が skip され、
    // 何の action も実行されない。usageLimit は宣言時に記録済みなので refund が必須
    // (これを怠ると「選べたのに何も起きないままゲーム1回分が消費される」silent bug になる)。
    let state: GameState = {
      ...buildState(),
      effectUsageRecords: [
        {
          sourceInstanceId: "src-1",
          sourceDefinitionId: "TEST-001",
          effectLabel: "magic",
          turnNumber: 1,
          step: "main",
          duration: "turn",
          count: 1,
        },
      ],
      players: buildState().players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              countValue: 1,
              lifeNormalCoreCount: 1,
              reserveNormalCoreCount: 10,
            }
          : p
      ),
    };
    const lifeBefore = state.players.find(
      (p) => p.id === "alice"
    )!.lifeNormalCoreCount;

    state = executeEffect({
      chainId: "test:p3-62-effect-not-activated-refund:579",
      state,
      effect: buildChoiceEffect(),
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggerLookup,
      choiceIndex: 1,
      recordedUsage: {
        effectLabel: "magic",
        usageLimit: turnLimit,
      },
    });

    // 何も実行されない (choice variant の action は不発。デフォルト action も走らない)
    expect(
      state.players.find((p) => p.id === "alice")!.lifeNormalCoreCount
    ).toBe(lifeBefore);
    // refund: レコード除去
    expect(state.effectUsageRecords).toHaveLength(0);
  });

  it("choice variant の condition 成立時は refund しない (通常発揮)", () => {
    let state: GameState = {
      ...buildState(),
      effectUsageRecords: [
        {
          sourceInstanceId: "src-1",
          sourceDefinitionId: "TEST-001",
          effectLabel: "magic",
          turnNumber: 1,
          step: "main",
          duration: "turn",
          count: 1,
        },
      ],
      players: buildState().players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              countValue: 5,
              lifeNormalCoreCount: 1,
              reserveNormalCoreCount: 10,
            }
          : p
      ),
    };

    state = executeEffect({
      chainId: "test:p3-62-effect-not-activated-refund:627",
      state,
      effect: buildChoiceEffect(),
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggerLookup,
      choiceIndex: 1,
      recordedUsage: {
        effectLabel: "magic",
        usageLimit: turnLimit,
      },
    });

    // 条件成立: life_fill(targetValue:5) が実行される
    expect(
      state.players.find((p) => p.id === "alice")!.lifeNormalCoreCount
    ).toBe(5);
    // 発揮できたので refund しない
    expect(state.effectUsageRecords).toHaveLength(1);
  });
});
