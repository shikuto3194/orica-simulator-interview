/**
 * P3-170 V16: 使用会計の公開投影。
 * 会計は能力由来の非公開カード情報(手札・伏せ札の定義ID、非公開宣言の使用)を含みうるので、
 * viewer ごとに投影する。本人は自分の枠・receiptを全て、相手・観戦者は公開が設計された枠
 * (ミラージュ免除の使用)だけを見る。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  sanitizeStateForViewer,
  type CardDefinition,
  type EffectUsageLimit,
  type GameState,
} from "../src";
import {
  consumeAdditionalAttackGrant,
  consumeConnectBattleUse,
  grantAdditionalAttack,
  grantConnectBattle,
  hasAdditionalAttackGrant,
} from "../src/mechanics/battle-grant-usage";
import {
  listActiveGrantsOnState,
  USAGE_OPERATION_REFERENCE_KEYS,
} from "../src/effect/effect-usage-accounting";
import { consumeMirageSetCountExemption } from "../src/mechanics/mirage-exemption-usage";
import {
  effectUsageEntryCount,
  listEffectUsage,
  seedEffectUsage,
} from "./helpers/effect-usage-fixture";

const def: CardDefinition = {
  cardNo: "T-SECRET",
  name: "秘匿カード",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
const lookup = (id: string): CardDefinition | undefined =>
  id === def.cardNo ? def : undefined;
const limit: EffectUsageLimit = { kind: "per_instance", duration: "turn" };

function build(): GameState {
  const a = createCardInstance(def, {
    instanceId: "a-hand",
    ownerPlayerId: "alice",
    zone: "hand",
  });
  const b = createCardInstance(def, {
    instanceId: "b-hand",
    ownerPlayerId: "bob",
    zone: "hand",
  });
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [a, b],
    }),
    turnNumber: 3,
    activePlayerId: "alice",
    step: "main",
  };
  state = seedEffectUsage(state, {
    sourceInstanceId: "a-hand",
    effectLabel: "effect:0",
    usageLimit: limit,
    getCardDefinitionById: lookup,
  });
  state = seedEffectUsage(state, {
    sourceInstanceId: "b-hand",
    effectLabel: "effect:0",
    usageLimit: limit,
    getCardDefinitionById: lookup,
  });
  return state;
}

describe("V16 使用会計の公開投影", () => {
  it("元の state は両者の枠を持つ(前提)", () => {
    expect(effectUsageEntryCount(build())).toBe(2);
  });

  it("本人は自分の枠だけを見る(相手の手札由来の枠は見えない)", () => {
    const state = build();
    const alice = sanitizeStateForViewer(state, "alice");
    expect(listEffectUsage(alice).map((e) => e.playerId)).toEqual(["alice"]);
    const bob = sanitizeStateForViewer(state, "bob");
    expect(listEffectUsage(bob).map((e) => e.playerId)).toEqual(["bob"]);
  });

  it("観戦者(viewer=null)は非公開由来の枠を一切見ない", () => {
    const spectator = sanitizeStateForViewer(build(), null);
    expect(spectator.effectAccounting.buckets).toEqual([]);
    expect(spectator.effectAccounting.operations).toEqual([]);
    expect(spectator.effectAccounting.grants).toEqual([]);
    // 手札の定義IDが会計経由で漏れていない
    expect(JSON.stringify(spectator.effectAccounting)).not.toContain(
      "T-SECRET"
    );
  });

  it("相手の非公開な消費は、採番カウンタの差分からも推定できない", () => {
    const before = build();
    const after = seedEffectUsage(before, {
      sourceInstanceId: "b-hand",
      effectLabel: "effect:1",
      usageLimit: limit,
      getCardDefinitionById: lookup,
    });
    // 元の state では bob の消費でカウンタが進んでいる(前提)
    expect(after.effectAccounting.nextOperationSeq).toBeGreaterThan(
      before.effectAccounting.nextOperationSeq
    );
    for (const viewer of ["alice", null] as const) {
      expect(
        sanitizeStateForViewer(after, viewer).effectAccounting.nextOperationSeq
      ).toBe(
        sanitizeStateForViewer(before, viewer).effectAccounting.nextOperationSeq
      );
    }
    // 本人にも、相手分の増加は見えない
    expect(
      sanitizeStateForViewer(after, "alice").effectAccounting.nextOperationSeq
    ).toBe(
      sanitizeStateForViewer(before, "alice").effectAccounting.nextOperationSeq
    );
  });

  it("公開 receipt (ミラージュ免除) の ID・採番からも、相手の非公開な消費の件数は分からない", () => {
    // bob の非公開消費 3 件 → alice の消費 1 件 → bob のミラージュ免除 (公開)。
    let state = build();
    for (const effectLabel of ["effect:1", "effect:2", "effect:3"])
      state = seedEffectUsage(state, {
        sourceInstanceId: "b-hand",
        effectLabel,
        usageLimit: limit,
        getCardDefinitionById: lookup,
      });
    state = seedEffectUsage(state, {
      sourceInstanceId: "a-hand",
      effectLabel: "effect:1",
      usageLimit: limit,
      getCardDefinitionById: lookup,
    });
    state = consumeMirageSetCountExemption({
      state,
      playerId: "bob",
      cardNo: "T-MIRAGE",
    });
    // 元 state では ID に欠番がある (前提: 他者の非公開な消費の分だけ進んでいる)
    expect(
      state.effectAccounting.operations.map((op) => op.operationId).length
    ).toBeGreaterThan(1);
    const ids = (viewer: string | null) =>
      sanitizeStateForViewer(state, viewer).effectAccounting.operations.map(
        (op) => op.operationId
      );
    // 観戦者は公開 receipt 1 件だけを見て、ID は 0 から詰まる
    expect(ids(null)).toEqual(["usage-op:0"]);
    expect(
      sanitizeStateForViewer(state, null).effectAccounting.nextOperationSeq
    ).toBe(1);
    // alice (自分の消費 + 公開 receipt) の ID も欠番なく詰まる
    const aliceIds = ids("alice");
    expect(aliceIds).toEqual(aliceIds.map((_, i) => `usage-op:${i}`));
    expect(
      sanitizeStateForViewer(state, "alice").effectAccounting.nextOperationSeq
    ).toBe(aliceIds.length);
  });

  it("追加アタック権は相手・観戦者にも公開される (旧 state でも伏せていなかった公開情報)", () => {
    const state = grantAdditionalAttack(build(), {
      actingPlayerId: "alice",
      sourceInstanceId: "a-hand",
      originKey: "chain-1",
    });
    for (const viewer of ["alice", "bob", null] as const)
      expect(
        sanitizeStateForViewer(state, viewer).effectAccounting.grants.map(
          (grant) => grant.grantKind
        )
      ).toEqual(["additional_attack"]);
  });

  it("追加アタック権の行使は、権利と同じ公開範囲で相手・観戦者にも見える(使用済みを未使用と誤認させない)", () => {
    const granted = grantAdditionalAttack(build(), {
      actingPlayerId: "alice",
      sourceInstanceId: "a-hand",
      originKey: "chain-1",
    });
    for (const viewer of ["alice", "bob", null] as const)
      expect(
        hasAdditionalAttackGrant(
          sanitizeStateForViewer(granted, viewer),
          "a-hand"
        )
      ).toBe(true);
    const used = consumeAdditionalAttackGrant(granted, "a-hand");
    expect(hasAdditionalAttackGrant(used, "a-hand")).toBe(false);
    for (const viewer of ["alice", "bob", null] as const)
      expect(
        hasAdditionalAttackGrant(sanitizeStateForViewer(used, viewer), "a-hand")
      ).toBe(false);
    // 公開されるのは権利の行使だけで、alice の手札由来の枠(effect:0)は bob には見えないまま
    expect(
      listEffectUsage(sanitizeStateForViewer(used, "bob")).filter(
        (entry) =>
          entry.sourceInstanceId === "a-hand" && entry.label === "effect:0"
      )
    ).toEqual([]);
  });

  it("コネクトバトル権の付与も、相手・観戦者の投影に残る", () => {
    const state = grantConnectBattle(
      {
        ...build(),
        activeAttack: {
          attackId: "atk-1",
          attackerInstanceId: "a-hand",
          attackerPlayerId: "alice",
        } as unknown as GameState["activeAttack"],
      },
      { actingPlayerId: "alice", sourceInstanceId: "a-hand", maxUses: 2 }
    );
    for (const viewer of ["alice", "bob", null] as const)
      expect(
        sanitizeStateForViewer(state, viewer).effectAccounting.grants.map(
          (grant) => grant.grantKind
        )
      ).toEqual(["connect_battle"]);
  });

  it("公開スタック・pending が運ぶ receipt 参照にも、生の採番や相手の非公開な消費の件数が残らない", () => {
    // bob の非公開消費 3 件 → alice の消費(スタックが参照)
    let state = build();
    for (const effectLabel of ["effect:1", "effect:2", "effect:3"])
      state = seedEffectUsage(state, {
        sourceInstanceId: "b-hand",
        effectLabel,
        usageLimit: limit,
        getCardDefinitionById: lookup,
      });
    state = seedEffectUsage(state, {
      sourceInstanceId: "a-hand",
      effectLabel: "effect:1",
      usageLimit: limit,
      getCardDefinitionById: lookup,
    });
    const aliceOps = state.effectAccounting.operations.filter((operation) =>
      operation.deltas.some(
        (delta) =>
          state.effectAccounting.buckets.find((b) => b.key === delta.bucketKey)
            ?.playerId === "alice"
      )
    );
    const aliceOpId = aliceOps[aliceOps.length - 1]!.operationId;
    const bobOpId = state.effectAccounting.operations.find(
      (operation) => !aliceOps.includes(operation)
    )!.operationId;
    expect(aliceOpId).not.toBe("usage-op:0"); // 元の ID は欠番を含む(前提)
    const carried = {
      ...state,
      stackWindow: {
        priorityPlayerId: "bob",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        pendingStackAction: {
          stackId: "stack:t",
          actionKind: "triggered_effect",
          chainId: "t",
          actingPlayerId: "alice",
          cardInstanceId: "a-hand",
          cardDefinitionId: def.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          recordedUsage: { operationIds: [aliceOpId, bobOpId] },
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
      },
    } as unknown as GameState;
    const recordedIds = (viewer: string | null): readonly string[] =>
      sanitizeStateForViewer(carried, viewer).stackWindow!.pendingStackAction!
        .recordedUsage!.operationIds;
    // 本人: 自分の receipt への参照だけが、投影した会計と同じ ID で残る(bob の分は取り除かれる)
    const aliceView = sanitizeStateForViewer(carried, "alice");
    expect(recordedIds("alice")).toEqual([
      aliceView.effectAccounting.operations.at(-1)!.operationId,
    ]);
    // 相手・観戦者: alice の非公開な receipt への参照は取り除かれ、元の採番が読めない
    expect(recordedIds("bob")).toEqual([
      sanitizeStateForViewer(carried, "bob").effectAccounting.operations[0]!
        .operationId,
    ]);
    expect(recordedIds(null)).toEqual([]);
    for (const viewer of ["bob", null] as const)
      expect(
        JSON.stringify(sanitizeStateForViewer(carried, viewer).stackWindow)
      ).not.toContain(aliceOpId);
    // 元の state は変更しない
    expect(
      carried.stackWindow!.pendingStackAction!.recordedUsage!.operationIds
    ).toEqual([aliceOpId, bobOpId]);
  });

  it("運搬される他の receipt 参照(pending の private 宣言・宣言取消の rollback・終了予約)も、相手には元の採番を残さず本人には投影後の ID で渡す", () => {
    let state = build();
    for (const effectLabel of ["effect:1", "effect:2", "effect:3"])
      state = seedEffectUsage(state, {
        sourceInstanceId: "b-hand",
        effectLabel,
        usageLimit: limit,
        getCardDefinitionById: lookup,
      });
    state = seedEffectUsage(state, {
      sourceInstanceId: "a-hand",
      effectLabel: "effect:1",
      usageLimit: limit,
      getCardDefinitionById: lookup,
    });
    const aliceOps = state.effectAccounting.operations.filter((operation) =>
      operation.deltas.some(
        (delta) =>
          state.effectAccounting.buckets.find((b) => b.key === delta.bucketKey)
            ?.playerId === "alice"
      )
    );
    const aliceOpId = aliceOps[aliceOps.length - 1]!.operationId;
    expect(aliceOpId).not.toBe("usage-op:0");
    const carried = {
      ...state,
      pendingTriggeredEffects: [
        {
          pendingId: "p1",
          actingPlayerId: "alice",
          privateDeclarationUsageOperationId: aliceOpId,
        },
      ],
      // 終了予約 (攻撃ステップ終了時の確定待ち) の払い戻し情報
      pendingAttackStepEndFinalizations: [
        { refundableUsage: { operationIds: [aliceOpId] } },
      ],
      // 通常手札プレイの宣言取消の差分 (スタックの rollback 配下)
      stackWindow: {
        priorityPlayerId: "bob",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        pendingStackAction: {
          stackId: "stack:t2",
          actionKind: "magic",
          chainId: "t2",
          actingPlayerId: "alice",
          cardInstanceId: "a-hand",
          cardDefinitionId: def.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
          normalHandPlayRollback: {
            declarationUsageOperationIds: [aliceOpId],
          },
        },
      },
    } as unknown as GameState;
    const collect = (view: GameState): string[] => {
      const v = view as unknown as {
        pendingTriggeredEffects: {
          privateDeclarationUsageOperationId?: string;
        }[];
        pendingAttackStepEndFinalizations: {
          refundableUsage: { operationIds: string[] };
        }[];
        stackWindow: {
          pendingStackAction: {
            normalHandPlayRollback: { declarationUsageOperationIds: string[] };
          };
        };
      };
      return [
        v.pendingTriggeredEffects[0]?.privateDeclarationUsageOperationId,
        ...v.pendingAttackStepEndFinalizations[0]!.refundableUsage.operationIds,
        ...v.stackWindow.pendingStackAction.normalHandPlayRollback
          .declarationUsageOperationIds,
      ].filter((id): id is string => typeof id === "string");
    };
    // 本人: 投影した会計の自分の receipt と同じ ID に写る
    const aliceView = sanitizeStateForViewer(carried, "alice");
    const aliceLast = aliceView.effectAccounting.operations.at(-1)!.operationId;
    expect(collect(aliceView)).toEqual([aliceLast, aliceLast, aliceLast]);
    // 相手・観戦者: alice の非公開な receipt への参照は取り除かれ、元の採番が読めない
    for (const viewer of ["bob", null] as const) {
      const view = sanitizeStateForViewer(carried, viewer);
      expect(collect(view)).toEqual([]);
      expect(JSON.stringify(view.pendingTriggeredEffects)).not.toContain(
        aliceOpId
      );
    }
  });

  it("終了予約が運搬する stepContext の stepUsageReceipts(usageGroupId -> receipt)も、相手・観戦者には元の採番を残さず本人には投影後の ID で渡す", () => {
    let state = build();
    for (const effectLabel of ["effect:1", "effect:2"])
      state = seedEffectUsage(state, {
        sourceInstanceId: "b-hand",
        effectLabel,
        usageLimit: limit,
        getCardDefinitionById: lookup,
      });
    state = seedEffectUsage(state, {
      sourceInstanceId: "a-hand",
      effectLabel: "effect:1",
      usageLimit: limit,
      getCardDefinitionById: lookup,
    });
    const aliceOps = state.effectAccounting.operations.filter((operation) =>
      operation.deltas.some(
        (delta) =>
          state.effectAccounting.buckets.find((b) => b.key === delta.bucketKey)
            ?.playerId === "alice"
      )
    );
    const aliceOpId = aliceOps[aliceOps.length - 1]!.operationId;
    expect(aliceOpId).not.toBe("usage-op:0");
    const carried = {
      ...state,
      pendingBattleEndDeferrals: [
        {
          restoredStepContext: {
            results: {},
            stepUsageReceipts: { "group-a": aliceOpId },
          },
        },
      ],
    } as unknown as GameState;
    const receipts = (view: GameState): Record<string, string> =>
      (
        view as unknown as {
          pendingBattleEndDeferrals: {
            restoredStepContext: { stepUsageReceipts: Record<string, string> };
          }[];
        }
      ).pendingBattleEndDeferrals[0]!.restoredStepContext.stepUsageReceipts;
    const aliceView = sanitizeStateForViewer(carried, "alice");
    expect(receipts(aliceView)).toEqual({
      "group-a": aliceView.effectAccounting.operations.at(-1)!.operationId,
    });
    for (const viewer of ["bob", null] as const) {
      const view = sanitizeStateForViewer(carried, viewer);
      expect(receipts(view)).toEqual({});
      expect(JSON.stringify(view.pendingBattleEndDeferrals)).not.toContain(
        aliceOpId
      );
    }
    // 元の state は変更しない
    expect(
      (
        carried as unknown as {
          pendingBattleEndDeferrals: {
            restoredStepContext: { stepUsageReceipts: Record<string, string> };
          }[];
        }
      ).pendingBattleEndDeferrals[0]!.restoredStepContext.stepUsageReceipts
    ).toEqual({ "group-a": aliceOpId });
  });

  it("型が receipt ID を運搬するプロパティ(...OperationId(s) / ...UsageReceipts)は、全て viewer 投影のキーに登録されている", () => {
    const declared = new Set<string>();
    for (const file of [
      "../src/model.ts",
      "../src/step-execution-context.ts",
    ]) {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");
      for (const match of text.matchAll(
        /^\s+(?:readonly\s+)?([A-Za-z]*(?:[Oo]perationIds?|UsageReceipts))\??:/gm
      ))
        declared.add(match[1]!);
    }
    // 検出できていること(空振りで常に通る検査にしない)
    expect([...declared].sort()).toEqual(
      expect.arrayContaining([
        "declarationUsageOperationIds",
        "operationIds",
        "privateDeclarationUsageOperationId",
        "stepUsageReceipts",
        "usageOperationId",
      ])
    );
    for (const key of declared)
      expect(
        USAGE_OPERATION_REFERENCE_KEYS.has(key),
        `${key} は receipt ID を運搬する。viewer 投影(effect-usage-accounting.ts の OPERATION_ID_*_KEYS)に登録するか、公開してよい理由をこの検査に明記する`
      ).toBe(true);
  });

  it("コネクトバトル権の行使も、付与と同じ公開範囲で相手・観戦者に見える(使用済みが残量に見えない)", () => {
    const granted = grantConnectBattle(
      {
        ...build(),
        activeAttack: {
          attackId: "atk-1",
          attackerInstanceId: "a-hand",
          attackerPlayerId: "alice",
        } as unknown as GameState["activeAttack"],
      },
      { actingPlayerId: "alice", sourceInstanceId: "a-hand", maxUses: 2 }
    );
    const grant = listActiveGrantsOnState(granted, {
      grantKind: "connect_battle",
    })[0]!;
    const used = consumeConnectBattleUse(granted, grant.grantId, "cb-use-1");
    const remaining = (view: GameState): number | undefined =>
      listActiveGrantsOnState(view, { grantKind: "connect_battle" })[0]
        ?.remaining;
    expect(remaining(used)).toBe(1);
    for (const viewer of ["alice", "bob", null] as const)
      expect(remaining(sanitizeStateForViewer(used, viewer))).toBe(1);
  });

  it("投影は元の state を変更しない", () => {
    const state = build();
    const before = JSON.stringify(state.effectAccounting);
    sanitizeStateForViewer(state, "alice");
    sanitizeStateForViewer(state, null);
    expect(JSON.stringify(state.effectAccounting)).toBe(before);
  });

  it("ミラージュ免除の使用は相手・観戦者にも公開される(公開情報量を維持)", () => {
    let state = build();
    state = consumeMirageSetCountExemption({
      state,
      playerId: "alice",
      cardNo: "T-MIRAGE",
    });
    const exemptionBuckets = (s: GameState) =>
      s.effectAccounting.buckets.filter((b) =>
        b.constraintId.includes("mirageData.exemptSetCountLimits")
      );
    expect(exemptionBuckets(state)).toHaveLength(1);
    expect(exemptionBuckets(sanitizeStateForViewer(state, "bob"))).toHaveLength(
      1
    );
    expect(exemptionBuckets(sanitizeStateForViewer(state, null))).toHaveLength(
      1
    );
    // 公開されるのは免除の枠だけ。alice の手札由来の枠(非公開)は bob には見えないまま。
    const bobView = sanitizeStateForViewer(state, "bob");
    const visibleNonExemption = bobView.effectAccounting.buckets.filter(
      (b) =>
        !b.constraintId.includes("mirageData.exemptSetCountLimits") &&
        b.playerId !== "bob"
    );
    expect(visibleNonExemption).toEqual([]);
  });
});
