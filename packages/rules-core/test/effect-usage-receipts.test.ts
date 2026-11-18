/**
 * P3-170 W2: 払い戻し情報 (recordedUsage) と二重消費防止は「操作ID (receipt)」で表す。
 *
 * - private 宣言で消費した共有制限は receipt を pending に残し、公開解決で二重消費しない
 *   (払い戻し対象にはしない現行挙動を維持する)。
 * - 取消は宣言時の消費の差分だけを戻し、同じ枠への他の消費を減らさない。
 * - 取消のため保持した receipt は、参照が無くなり作成ターンが終わると整理される (保持は有界)。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState } from "../src";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
} from "../src";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  effectUsageAmount,
  pruneExpiredEffectUsageForTest,
  seedEffectUsage,
} from "./helpers/effect-usage-fixture";

const TURN_LIMIT_DEF: CardDefinition = {
  cardNo: "W2-RECEIPT-HAND",
  name: "W2 receipt hand",
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
  effects: [
    {
      timing: { kind: "phase", step: "start", subPhase: "start" },
      applicability: { zone: "hand" },
      executionMode: "optional",
      usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
      steps: [{ action: { kind: "draw", count: 1 } }],
    },
  ],
};

const lookup = (id: string) =>
  id === TURN_LIMIT_DEF.cardNo ? TURN_LIMIT_DEF : undefined;
const triggerLookup = buildTriggeredEffectLookup([TURN_LIMIT_DEF]);

function declaredPrivately(): GameState {
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(TURN_LIMIT_DEF, {
        instanceId: "w2-hand-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
    ],
  });
  const queued = queuePendingReactionsFromTriggerEvents(
    state,
    [
      {
        actingPlayerId: "alice",
        eventKind: "start_step",
        source: "step_transition",
        chainId: "test:effect-usage-receipts:start",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: null,
        amount: null,
        step: "start",
        subPhase: "start",
      },
    ],
    undefined,
    {
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: () => undefined,
    }
  );
  const declare = getLegalActions({
    state: queued,
    actingPlayerId: "alice",
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: triggerLookup,
  }).find((action) => action.kind === "declare_private_triggered_effect");
  if (!declare) throw new Error("missing declare_private_triggered_effect");
  return applyLegalAction({
    state: queued,
    action: declare,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: triggerLookup,
  }).state;
}

describe("private 宣言で消費した共有制限は receipt で二重消費を防ぐ", () => {
  it("pending が消費の operationId を持ち、公開解決しても枠は 1 回のまま (払い戻し情報は作らない)", () => {
    const declared = declaredPrivately();
    expect(declared.pendingTriggeredEffects).toHaveLength(1);
    const pending = declared.pendingTriggeredEffects[0]!;
    // private 宣言の時点で共有制限を 1 回消費し、その receipt を参照している
    expect(effectUsageAmount(declared, "effect:0")).toBe(1);
    expect(pending.privateDeclarationUsageOperationId).toBeDefined();
    expect(
      declared.effectAccounting.operations.find(
        (operation) =>
          operation.operationId === pending.privateDeclarationUsageOperationId
      )?.status
    ).toBe("applied");

    const resolve = getLegalActions({
      state: declared,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).find((action) => action.kind === "resolve_pending_triggered_effect");
    // 自分の消費で自分をブロックしない (receipt があるので使用可否の再確認を飛ばす)
    expect(resolve).toBeDefined();

    const resolved = applyLegalAction({
      state: declared,
      action: resolve!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).state;
    // 二重消費しない
    expect(effectUsageAmount(resolved, "effect:0")).toBe(1);
    // 現行挙動: private 宣言済みの誘発は払い戻し情報 (recordedUsage) を持たない
    const stack = resolved.stackWindow?.pendingStackAction;
    expect(stack).toBeDefined();
    expect(stack?.recordedUsage).toBeUndefined();
  });
});

describe("receipt の保持は参照がある間だけで、有界", () => {
  const LIMIT = { kind: "per_instance", duration: "turn" } as const;

  function withRetainedOperation(): GameState {
    const base: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(TURN_LIMIT_DEF, {
            instanceId: "w2-hand-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
      }),
      turnNumber: 3,
    };
    const seeded = seedEffectUsage(base, {
      sourceInstanceId: "w2-hand-1",
      effectLabel: "effect:0",
      usageLimit: LIMIT,
    });
    // 取消のため保持した消費 (retain) は released でない
    return {
      ...seeded,
      effectAccounting: {
        ...seeded.effectAccounting,
        operations: seeded.effectAccounting.operations.map(
          ({ released: _released, ...operation }) => operation
        ),
      },
    };
  }

  it("宣言スタックが recordedUsage で参照している間は、ターンが進んでも receipt を消さない", () => {
    const state = withRetainedOperation();
    const operationId = state.effectAccounting.operations[0]!.operationId;
    const referenced: GameState = {
      ...state,
      stackWindow: {
        priorityPlayerId: "bob",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        pendingStackAction: {
          stackId: "stack:w2",
          actionKind: "triggered_effect",
          chainId: "w2",
          actingPlayerId: "alice",
          cardInstanceId: "w2-hand-1",
          cardDefinitionId: TURN_LIMIT_DEF.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          recordedUsage: { operationIds: [operationId] },
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
      },
    } as unknown as GameState;

    const nextTurn = pruneExpiredEffectUsageForTest({
      ...referenced,
      turnNumber: 5,
    });
    expect(
      nextTurn.effectAccounting.operations.map((op) => op.operationId)
    ).toContain(operationId);
  });

  it("参照が無くなれば release され、作成ターンが生存しなくなった時点で整理される", () => {
    const state = withRetainedOperation();
    // 同じターン内では (release されても) まだ作成ターンが生存するので残る
    const sameTurn = pruneExpiredEffectUsageForTest(state);
    expect(sameTurn.effectAccounting.operations).toHaveLength(1);
    expect(sameTurn.effectAccounting.operations[0]!.released).toBe(true);

    const nextTurn = pruneExpiredEffectUsageForTest({
      ...sameTurn,
      turnNumber: 5,
    });
    expect(nextTurn.effectAccounting.operations).toHaveLength(0);
  });
});

describe("消費に失敗した呼出しは state を変更しない", () => {
  it("上限に達した2回目の消費は同じ state 参照を返し、採番も進めない", () => {
    const base: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(TURN_LIMIT_DEF, {
            instanceId: "w2-hand-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
      }),
      turnNumber: 3,
    };
    const options = {
      sourceInstanceId: "w2-hand-1",
      effectLabel: "effect:0",
      usageLimit: { kind: "per_instance", duration: "turn" } as const,
    };
    const once = seedEffectUsage(base, options);
    expect(once.effectAccounting.operations.length).toBeGreaterThan(0);
    const failed = seedEffectUsage(once, options);
    expect(failed).toBe(once);
    expect(failed.effectAccounting.nextOperationSeq).toBe(
      once.effectAccounting.nextOperationSeq
    );
  });
});
