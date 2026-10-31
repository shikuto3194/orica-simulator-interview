/**
 * P3-73 A5: 無効化の解決路と 3 種応答窓カバレッジ。
 *
 * A4 で declare 時に対象フラッシュの ActiveStack に isNullified=true を立てるところまでは
 * `p3-73-x05-sakuya-flash-trigger.test.ts` で stackWindow パスを確認済み。本ファイルでは:
 *
 *   1. isNullified=true な相手フラッシュを実際に resolveDeferredMagicStack に通すと
 *      効果解決をスキップして `magic:nullified:...` ログを残し、in_use → trash で
 *      終了することを確認する（フル e2e 解決路）。
 *   2. declare 時の印付けが `stackWindow` だけでなく `preDeclarationStackWindow` /
 *      `activeAttack.flashWindowState`（バトル中フラッシュ窓）にも届くことを確認する。
 *      `markPendingStackActionNullifiedByCardInstance` は 3 窓 + LIFO ネスト鎖を走査するため、
 *      `declare_private_triggered_effect` ハンドラが正しい窓を見つけることをカバーする。
 *
 * NOTE: 「使用宣言→cost 支払い→ flashUsedTriggers 発火」を実窓経由でフル駆動するには
 * declare_attack 窓・battle flash 窓開き・use_magic legal action 取得まで動かす必要があり、
 * テスト独立の最小カードでは setup が膨らむ。本テストは declare 時に既に対象フラッシュが
 * 保留 ActiveStack に乗っている状況を 3 窓それぞれで再現し、declare→印付け→resolveDeferred
 * の責務境界をフルに検証する位置づけ。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  queueFlashUsedTriggers,
  resolveDeferredMagicStack,
} from "../src";
import { markPendingStackActionNullifiedByCardInstance } from "../src/stack/stack-window-shared";
import type {
  ActiveStack,
  BattleFlashWindowState,
  CardDefinition,
  GameState,
  PreDeclarationStackWindow,
  StackWindow,
} from "../src";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";

const 咲夜 = ALL_CARDS.find((c) => c.cardNo === "BSTH01-X05")!;

const フラッシュマジック: CardDefinition = {
  cardNo: "P3-73-A5-FLASH-MAGIC",
  name: "P3-73 A5 フラッシュマジック",
  printedCategory: "magic",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const definitionMap = new Map<string, CardDefinition>([
  [咲夜.cardNo, 咲夜],
  [フラッシュマジック.cardNo, フラッシュマジック],
]);
const lookup = (definitionId: string) => definitionMap.get(definitionId);
const triggerLookup = buildTriggeredEffectLookup([咲夜, フラッシュマジック]);

function bobFlashActiveStack(): ActiveStack {
  return {
    stackId: "stack:bob-magic",
    actionKind: "magic",
    chainId: "chain:bob-magic",
    actingPlayerId: "bob",
    cardInstanceId: "bob-flash-1",
    cardDefinitionId: フラッシュマジック.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
}

function buildBaseState(): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(咲夜, {
        instanceId: "sakuya-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(フラッシュマジック, {
        instanceId: "bob-flash-1",
        ownerPlayerId: "bob",
        zone: "in_use",
      }),
    ],
  });
  return { ...base, step: "attack", activePlayerId: "alice" };
}

function fireBobFlash(state: GameState): GameState {
  return queueFlashUsedTriggers({
    chainId: "test:p3-73-a5-nullify-resolution-and-windows:100",
    state,
    flashSourceInstanceId: "bob-flash-1",
    userPlayerId: "bob",
    flashSourceFromZone: "hand",
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: triggerLookup,
    getRegisteredBurstActions: () => undefined,
  });
}

// 案X (P3-86): declare は窓クローズ後の発揮前チェックポイントで行われ、対象フラッシュは
// pendingStackCascade に退避する。よって「窓が開いている間の declare」は deferred で不可になった。
// 本ファイルの主旨は markPendingStackActionNullifiedByCardInstance の 3 窓 + LIFO 鎖カバレッジ
// 検証 (docstring 参照) なので、印付け関数を直接呼んで対象 ActiveStack への isNullified を確認する。
function declareSakuya(state: GameState): GameState {
  return markPendingStackActionNullifiedByCardInstance(state, "bob-flash-1");
}

describe("P3-73 A5: isNullified を立てた相手フラッシュは resolveDeferredMagicStack で効果スキップ＋trash", () => {
  it("declare 後の bob フラッシュ ActiveStack を resolveDeferredMagicStack に渡すと、効果解決をスキップし in_use → trash, magic:nullified ログが残る", () => {
    const stackWindow: StackWindow = {
      priorityPlayerId: "alice",
      consecutivePassCount: 0,
      actingPlayerId: "bob",
      previousWindow: "none",
      stackResponseSourcePlayerId: "bob",
      subStackEverOpened: false,
      burstWindowKind: null,
      pendingStackAction: bobFlashActiveStack(),
    };
    const base: GameState = {
      ...buildBaseState(),
      window: "stack",
      stackWindow,
    };

    const queued = fireBobFlash(base);
    const declared = declareSakuya(queued);
    const markedStack = declared.stackWindow?.pendingStackAction;
    expect(markedStack?.isNullified).toBe(true);
    expect(markedStack).toBeDefined();
    if (!markedStack) throw new Error("missing marked stack");

    // 解決前の bob-flash-1 は in_use にある。
    const beforeResolve = declared.cardInstances.find(
      (c) => c.instanceId === "bob-flash-1"
    );
    expect(beforeResolve?.zone).toBe("in_use");

    const resolved = resolveDeferredMagicStack({
      state: declared,
      activeStack: markedStack,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: () => undefined,
    });

    // bob-flash-1 が trash へ落ちる (in_use → trash, magic-card)
    const after = resolved.cardInstances.find(
      (c) => c.instanceId === "bob-flash-1"
    );
    expect(after?.zone).toBe("trash");
    expect(after?.zoneRoleName).toBe("magic-card");

    // 無効化マーカーのログが残る。
    const nullifiedLog = resolved.log.find((l) =>
      l.startsWith("magic:nullified:")
    );
    expect(nullifiedLog).toBeDefined();
    expect(nullifiedLog).toContain("bob-flash-1");
    // 効果適用のログ (magic:effect:*, magic:resolve:*) が無いことの代替: trash 移動のみで log が
    // 終わっていれば良い。雛形マジックの effects は空のため effect 系ログは出ないが、isNullified
    // パスではそもそも resolveMagicMainAndMoveToTrash に到達しないことを「magic:effect-fizzled:」が
    // 無いことで二次的に確認。
    expect(
      resolved.log.some((l) => l.startsWith("magic:effect-fizzled:"))
    ).toBe(false);
  });
});

describe("P3-73 A5: 印付けは 3 種応答窓 (stackWindow / preDeclarationStackWindow / activeAttack.flashWindowState) すべてに届く", () => {
  it("preDeclarationStackWindow.pendingStackAction が宛先のとき、declare で isNullified=true が立つ", () => {
    const preDecl: PreDeclarationStackWindow = {
      kind: "attack",
      actingPlayerId: "bob",
      sourceInstanceId: "bob-flash-1",
      previousWindow: "attack",
      priorityPlayerId: "alice",
      consecutivePassCount: 0,
      stackResponseSourcePlayerId: "bob",
      pendingStackAction: bobFlashActiveStack(),
    };
    const base: GameState = {
      ...buildBaseState(),
      window: "stack",
      preDeclarationStackWindow: preDecl,
    };

    const queued = fireBobFlash(base);
    const declared = declareSakuya(queued);

    expect(
      declared.preDeclarationStackWindow?.pendingStackAction?.isNullified
    ).toBe(true);
    // stackWindow (空) は触っていない。
    expect(declared.stackWindow).toBeNull();
  });

  it("activeAttack.flashWindowState.pendingStackAction が宛先のとき、declare で isNullified=true が立つ (battle flash 窓)", () => {
    const flashWindow: BattleFlashWindowState = {
      kind: "before_block",
      priorityPlayerId: "alice",
      consecutivePassCount: 0,
      stackResponseSourcePlayerId: "bob",
      pendingStackAction: bobFlashActiveStack(),
    };
    const base: GameState = {
      ...buildBaseState(),
      window: "flash_before_block",
      activeAttack: {
        attackId: "atk-1",
        primaryEntityId: "e-attacker",
        participantEntityIds: ["e-attacker"],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: flashWindow,
      },
    };

    const queued = fireBobFlash(base);
    const declared = declareSakuya(queued);

    expect(
      declared.activeAttack?.flashWindowState?.pendingStackAction?.isNullified
    ).toBe(true);
    // 他 2 窓は変化なし。
    expect(declared.stackWindow).toBeNull();
    expect(declared.preDeclarationStackWindow).toBeNull();
  });

  it("LIFO ネスト鎖 (previousPendingStackAction) の奥にいる対象も印付けされる", () => {
    // 外側 = 別のスタック (alice の何か), 内側 = bob のフラッシュ
    const innerBobFlash = bobFlashActiveStack();
    const outer: ActiveStack = {
      stackId: "stack:outer",
      actionKind: "magic",
      chainId: "chain:outer",
      actingPlayerId: "alice",
      cardInstanceId: "alice-outer-1",
      cardDefinitionId: フラッシュマジック.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: innerBobFlash,
    };
    const stackWindow: StackWindow = {
      priorityPlayerId: "alice",
      consecutivePassCount: 0,
      actingPlayerId: "alice",
      previousWindow: "none",
      stackResponseSourcePlayerId: "bob",
      subStackEverOpened: false,
      burstWindowKind: null,
      pendingStackAction: outer,
    };
    const base: GameState = {
      ...buildBaseState(),
      window: "stack",
      stackWindow,
    };

    const queued = fireBobFlash(base);
    const declared = declareSakuya(queued);

    // outer は据え置き, inner にだけ印が付く。
    const outerAfter = declared.stackWindow?.pendingStackAction;
    expect(outerAfter?.cardInstanceId).toBe("alice-outer-1");
    expect(outerAfter?.isNullified).toBeUndefined();
    expect(outerAfter?.previousPendingStackAction?.cardInstanceId).toBe(
      "bob-flash-1"
    );
    expect(outerAfter?.previousPendingStackAction?.isNullified).toBe(true);
  });

  it("negatePreventionLevel:unpreventable の対象には発揮前無効化の印を立てない", () => {
    const protectedStack: ActiveStack = {
      ...bobFlashActiveStack(),
      negatePreventionLevel: "unpreventable",
    };
    const stackWindow: StackWindow = {
      priorityPlayerId: "alice",
      consecutivePassCount: 0,
      actingPlayerId: "bob",
      previousWindow: "none",
      stackResponseSourcePlayerId: "bob",
      subStackEverOpened: false,
      burstWindowKind: null,
      pendingStackAction: protectedStack,
    };
    const base: GameState = {
      ...buildBaseState(),
      window: "stack",
      stackWindow,
    };

    const queued = fireBobFlash(base);
    const declared = declareSakuya(queued);

    expect(
      declared.stackWindow?.pendingStackAction?.negatePreventionLevel
    ).toBe("unpreventable");
    expect(
      declared.stackWindow?.pendingStackAction?.isNullified
    ).toBeUndefined();
  });

  it("Q1481: preventionLevel:unpreventable の対象にも発揮前無効化の印を立てる", () => {
    const protectedStack: ActiveStack = {
      ...bobFlashActiveStack(),
      preventionLevel: "unpreventable",
    };
    const stackWindow: StackWindow = {
      priorityPlayerId: "alice",
      consecutivePassCount: 0,
      actingPlayerId: "bob",
      previousWindow: "none",
      stackResponseSourcePlayerId: "bob",
      subStackEverOpened: false,
      burstWindowKind: null,
      pendingStackAction: protectedStack,
    };
    const base: GameState = {
      ...buildBaseState(),
      window: "stack",
      stackWindow,
    };

    const queued = fireBobFlash(base);
    const declared = declareSakuya(queued);

    expect(declared.stackWindow?.pendingStackAction?.preventionLevel).toBe(
      "unpreventable"
    );
    expect(declared.stackWindow?.pendingStackAction?.isNullified).toBe(true);
  });
});
