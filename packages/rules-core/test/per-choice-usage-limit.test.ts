/**
 * choice 変種ごとに独立した使用制限 (「これらの効果はターンに1回ずつしか使えない」)。
 *
 * - effect 単位の `Effect.usageLimit` は従来どおり変種間で共有 (P3-24、回帰テスト
 *   choice-shared-usage-limit.test.ts)。
 * - `EffectStep.usageLimit` (デフォルト変種) / `choice[k].usageLimit` (変種 k) は
 *   変種ごとに独立し、`<stable label>:choice:<choiceIndex>` の変種別ラベルで
 *   消費・封鎖・払い戻しされる。
 *
 * 需要カード:
 * - BSTH01-C05 [紅魔郷]チルノ: 召喚/アタック時、バウンス or ドロー (ターンに1回ずつ)。
 * - BSTH01-C21 彗星「ブレイジングスター」: フラッシュ、ブロックされない or アタック終了
 *   (相手の効果を受けなかったとき、ゲーム中に1回ずつ)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  finalizePendingAttackStepEndFinalizations,
  generateBattleImmediateEffectRegistrations,
  generateMagicRegistrations,
  generateTriggeredEffectRegistrations,
  getLegalActions,
  recordEffectUsageIfLimited,
} from "../src";
import type {
  CardDefinition,
  ContinuousEffect,
  EffectUsageLimit,
  GameState,
  PendingTriggeredEffect,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const cirno = cardNoMap.get("BSTH01-C05")!;
const blazingStar = cardNoMap.get("BSTH01-C21")!;

const bobSpirit: CardDefinition = {
  cardNo: "PCUL-BOB-SPIRIT",
  name: "PCUL ボブスピリット",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const defs = [cirno, blazingStar, bobSpirit];
const defMap = new Map(defs.map((d) => [d.cardNo, d]));
const lookups = {
  getCardDefinitionById: (id: string) => defMap.get(id),
  getRegisteredMagicActions: buildMagicLookup(defs),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(defs),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
  getRegisteredBurstActions: buildBurstEffectLookup(defs),
};

describe("registration 集約: per-entry usageLimit は choices[] に保持され共有制限に潰されない", () => {
  it("C05 triggered: registration.usageLimit 無し / choices[k].usageLimit が per_instance turn", () => {
    const regs = generateTriggeredEffectRegistrations(cirno);
    // card_event ["summon","attack"] のうち triggered は summon のみ (attack は BIE 系)
    expect(regs).toHaveLength(1);
    const reg = regs[0]!;
    expect(reg.effectIndex).toBe(1);
    expect(reg.usageLimit).toBeUndefined();
    expect(reg.choices).toHaveLength(2);
    expect(reg.choices![0]!.usageLimit).toMatchObject({
      kind: "per_instance",
      duration: "turn",
    });
    expect(reg.choices![1]!.usageLimit).toMatchObject({
      kind: "per_instance",
      duration: "turn",
    });
  });

  it("C05 battle immediate (アタック時) も同様に per-entry を保持する", () => {
    const regs = generateBattleImmediateEffectRegistrations(cirno);
    expect(regs).toHaveLength(1);
    expect(regs[0]!.usageLimit).toBeUndefined();
    expect(regs[0]!.choices).toHaveLength(2);
    expect(regs[0]!.choices![0]!.usageLimit).toBeDefined();
  });

  it("C21 magic: flash registration が choices[] + per_card_name game を保持 (flash→stack 派生は廃止)", () => {
    // フラッシュ効果はスタック効果ではない (公式Q&A Q5) ため flash→stack 派生 reg は生成しない。
    // flash 効果は flash timing でのみ使用 (スタック応答に出るのは mode:"stack" のみ)。
    const regs = generateMagicRegistrations(blazingStar);
    expect(regs.map((r) => r.timing).sort()).toEqual(["flash"]);
    for (const reg of regs) {
      expect(reg.effectIndex).toBe(1);
      expect(reg.usageLimit).toBeUndefined();
      expect(reg.choices).toHaveLength(2);
      expect(reg.choices![0]!.usageLimit).toMatchObject({
        kind: "per_card_name",
        duration: "game",
        unlessAffectedByOpponent: true,
      });
      expect(reg.choices![1]!.usageLimit).toMatchObject({
        kind: "per_card_name",
        duration: "game",
        unlessAffectedByOpponent: true,
      });
    }
  });
});

// --- C05 triggered (summon) E2E ---

function makeSummonPending(pendingId: string): PendingTriggeredEffect {
  return {
    pendingId,
    eventKind: "summon",
    actingPlayerId: "alice",
    source: "action_resolution",
    chainId: "test:per-choice-usage-limit:128",
    attackId: null,
    relatedPlayerId: null,
    relatedInstanceId: "cirno-1",
    amount: null,
    step: "main",
    window: "default",
    resolvedSourceInstanceIds: [],
  } as PendingTriggeredEffect;
}

function makeCirnoState(): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(cirno, {
        instanceId: "cirno-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(bobSpirit, {
        instanceId: "bob-spirit-1",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
    ],
    playerOverrides: [{ deckCount: 5 }],
  });
  return {
    ...base,
    step: "main",
    activePlayerId: "alice",
    turnNumber: 2,
    pendingTriggeredEffects: [makeSummonPending("pcul-pending-1")],
  };
}

function getCirnoVariantActions(state: GameState) {
  return getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  }).filter((a) => a.kind === "resolve_pending_triggered_effect") as Array<{
    kind: "resolve_pending_triggered_effect";
    choiceIndex?: number;
    deferredChoiceIndexes?: readonly number[];
    skipOnly?: boolean;
    [key: string]: unknown;
  }>;
}

/** 宣言 → スタック窓 → bob パスで窓クローズまでを実行する */
function declareAndClose(
  state: GameState,
  action: Parameters<typeof applyLegalAction>[0]["action"],
  choiceIndex: number,
  targetInstanceIds?: string[]
): GameState {
  const declared = applyLegalAction({
    state,
    action,
    ...lookups,
  });
  expect(declared.state.stackWindow).not.toBeNull();
  const passAction = getLegalActions({
    state: declared.state,
    actingPlayerId: "bob",
    ...lookups,
  }).find((a) => a.kind === "pass_stack");
  expect(passAction).toBeDefined();
  let current = applyLegalAction({
    state: declared.state,
    action: passAction!,
    ...lookups,
  }).state;
  if (current.pendingStepChoice !== null) {
    const choiceAction = getLegalActions({
      state: current,
      actingPlayerId: current.pendingStepChoice.choosingPlayerId,
      ...lookups,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_step_choice" &&
        candidate.choiceIndex === choiceIndex
    );
    expect(choiceAction).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: choiceAction!,
      ...lookups,
    }).state;
  }
  if (current.pendingEffectTargetSelection !== null) {
    const targetAction = getLegalActions({
      state: current,
      actingPlayerId: current.pendingEffectTargetSelection.actingPlayerId,
      ...lookups,
    }).find((candidate) => candidate.kind === "resolve_pending_effect_target");
    expect(targetAction).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: targetAction!,
      targetInstanceIds: targetInstanceIds ?? [],
      ...lookups,
    }).state;
  }
  return current;
}

describe("BSTH01-C05: triggered choice 変種は独立した「ターンに1回ずつ」", () => {
  it("バウンス変種使用後、バウンスは封鎖・ドロー変種は使用可。両方使用後は skipOnly のみ", () => {
    const state = makeCirnoState();
    const variantActions = getCirnoVariantActions(state);
    expect(variantActions).toHaveLength(1);
    expect(variantActions[0]!.choiceIndex).toBeUndefined();
    expect(variantActions[0]!.deferredChoiceIndexes).toEqual([0, 1]);

    // 変種 A (choiceIndex 0 = バウンス) を使用
    const bounceAction = variantActions[0]!;
    const afterBounce = declareAndClose(state, bounceAction, 0, [
      "bob-spirit-1",
    ]);
    expect(
      afterBounce.cardInstances.find((c) => c.instanceId === "bob-spirit-1")
        ?.zone
    ).toBe("hand");
    // 変種別ラベルで記録される (effect 単位の共有ラベルではない)
    expect(
      afterBounce.effectUsageRecords.some(
        (r) => r.effectLabel === "effect:1:choice:0"
      )
    ).toBe(true);
    expect(
      afterBounce.effectUsageRecords.some((r) => r.effectLabel === "effect:1")
    ).toBe(false);

    // 同一ターンに再誘発: バウンスは封鎖、ドローは使用可
    const requeued: GameState = {
      ...afterBounce,
      pendingTriggeredEffects: [makeSummonPending("pcul-pending-2")],
    };
    const secondActions = getCirnoVariantActions(requeued);
    expect(secondActions).toHaveLength(1);
    expect(secondActions[0]!.deferredChoiceIndexes).toEqual([1]);
    const drawAction = secondActions[0];
    expect(drawAction).toBeDefined();

    // 変種 B (choiceIndex 1 = ドロー 2) を使用
    const handBefore =
      requeued.players.find((p) => p.id === "alice")?.handCount ?? 0;
    const afterDraw = declareAndClose(requeued, drawAction!, 1);
    expect(afterDraw.players.find((p) => p.id === "alice")?.handCount).toBe(
      handBefore + 2
    );

    // 両変種使用済み: 発揮可能 variant が無く、owner への drain 専用 skipOnly のみ
    const exhausted: GameState = {
      ...afterDraw,
      pendingTriggeredEffects: [makeSummonPending("pcul-pending-3")],
    };
    const thirdActions = getCirnoVariantActions(exhausted);
    expect(thirdActions.length).toBeGreaterThan(0);
    expect(thirdActions.every((a) => a.skipOnly === true)).toBe(true);
  });

  it("ターンが変われば両変種ともリセットされる", () => {
    const state = makeCirnoState();
    const bounceAction = getCirnoVariantActions(state)[0]!;
    let current = declareAndClose(state, bounceAction, 0, ["bob-spirit-1"]);
    const drawAction = getCirnoVariantActions({
      ...current,
      pendingTriggeredEffects: [makeSummonPending("pcul-pending-2")],
    })[0]!;
    current = declareAndClose(
      {
        ...current,
        pendingTriggeredEffects: [makeSummonPending("pcul-pending-2")],
      },
      drawAction,
      1
    );

    // 次ターン: per_instance turn の記録はスコープ外になり、両変種が再度使用可
    const nextTurn: GameState = {
      ...current,
      turnNumber: current.turnNumber + 1,
      pendingTriggeredEffects: [makeSummonPending("pcul-pending-next")],
    };
    const nextTurnActions = getCirnoVariantActions(nextTurn);
    expect(nextTurnActions).toHaveLength(1);
    expect(nextTurnActions[0]!.deferredChoiceIndexes).toEqual([0, 1]);
  });
});

// --- C21 magic (flash) E2E ---

function makeBlazingStarState(): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(blazingStar, {
        instanceId: "bs-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(blazingStar, {
        instanceId: "bs-2",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
    ],
    playerOverrides: [{ deckCount: 5, reserveNormalCoreCount: 10 }],
  });
  return {
    ...base,
    step: "main",
    activePlayerId: "alice",
    turnNumber: 2,
  };
}

function getBlazingStarActions(state: GameState, instanceId: string) {
  return getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  }).filter(
    (a) => a.kind === "use_magic" && a.sourceInstanceId === instanceId
  ) as Array<{
    kind: "use_magic";
    actionId: string;
    choiceIndex?: number;
    deferredChoiceIndexes?: readonly number[];
    finalCost: number;
    [key: string]: unknown;
  }>;
}

describe("BSTH01-C21: magic choice 変種は独立した「ゲーム中に1回ずつ」", () => {
  it("アタック終了変種使用後、同変種は封鎖・ブロックされない変種は使用可 (同名カード)", () => {
    const state = makeBlazingStarState();
    const actions = getBlazingStarActions(state, "bs-1");
    // 本文上1効果なので宣言は1本、合法な枝だけを窓後選択候補として保持する。
    expect(actions).toHaveLength(1);
    expect(actions[0]!.choiceIndex).toBeUndefined();
    expect(actions[0]!.deferredChoiceIndexes).toEqual([0, 1]);

    // 変種 B (choiceIndex 1 = アタック終了) を妨害なしで使用
    const endAttackAction = actions[0]!;
    const declared = applyLegalAction({
      state,
      action: endAttackAction,
      paymentSources: [{ kind: "reserve", amount: endAttackAction.finalCost }],
      ...lookups,
    });
    expect(declared.state.stackWindow).not.toBeNull();
    expect(
      declared.state.stackWindow!.pendingStackAction!.magicChoiceIndex
    ).toBeUndefined();
    expect(
      declared.state.stackWindow!.pendingStackAction!.deferredChoiceIndexes
    ).toEqual([0, 1]);
    const passAction = getLegalActions({
      state: declared.state,
      actingPlayerId: "bob",
      ...lookups,
    }).find((a) => a.kind === "pass_stack")!;
    const afterStack = applyLegalAction({
      state: declared.state,
      action: passAction,
      ...lookups,
    }).state;
    expect(afterStack.pendingStepChoice).not.toBeNull();
    const choiceAction = getLegalActions({
      state: afterStack,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_step_choice" &&
        candidate.choiceIndex === 1
    );
    expect(choiceAction).toBeDefined();
    const resolved = applyLegalAction({
      state: afterStack,
      action: choiceAction!,
      ...lookups,
    }).state;

    // 解決済み: カードはトラッシュ、使用記録は変種別ラベル
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "bs-1")?.zone
    ).toBe("trash");
    expect(
      resolved.effectUsageRecords.some(
        (r) => r.effectLabel === "magic:choice:1"
      )
    ).toBe(true);
    expect(
      resolved.effectUsageRecords.some((r) => r.effectLabel === "magic")
    ).toBe(false);

    // 同名 2 枚目: per_card_name game により choiceIndex 1 は封鎖、choiceIndex 0 は使用可
    const secondActions = getBlazingStarActions(resolved, "bs-2");
    expect(secondActions).toHaveLength(1);
    expect(secondActions[0]!.deferredChoiceIndexes).toEqual([0]);
  });
});

// --- unlessAffectedByOpponent 払い戻し (変種別ラベル) ---

const C21_VARIANT_LIMIT: EffectUsageLimit = {
  kind: "per_card_name",
  duration: "game",
  unlessAffectedByOpponent: true,
};

function makeRefundState(withRestriction: boolean): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(blazingStar, {
        instanceId: "bs-refund",
        ownerPlayerId: "alice",
        zone: "in_use",
      }),
    ],
  });
  const restrictionCe: ContinuousEffect = {
    effectId: "pcul-restrict-1",
    sourceInstanceId: "bob-nexus-1",
    sourceDefinitionId: "BOB-NEXUS",
    actingPlayerId: "bob",
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "restrict_end_attack_step",
    targetInstanceId: "alice",
  };
  let state: GameState = {
    ...base,
    activePlayerId: "alice",
    step: "attack",
    turnNumber: 2,
    activeContinuousEffects: withRestriction ? [restrictionCe] : [],
  };
  // 宣言時の変種別ラベルでの usageLimit 消費を再現 (use_magic apply と同じ記録)
  state = recordEffectUsageIfLimited({
    state,
    sourceInstanceId: "bs-refund",
    sourceDefinitionId: blazingStar.cardNo,
    playerId: "alice",
    effectLabel: "magic:choice:1",
    usageLimit: C21_VARIANT_LIMIT,
  });
  expect(state.effectUsageRecords).toHaveLength(1);
  return state;
}

function runBlazingStarEndAttack(state: GameState): GameState {
  return executeEffect({
    chainId: "test:per-choice-usage-limit:495",
    state,
    effect: blazingStar.effects![1]!,
    effectIndex: 1,
    sourceInstanceId: "bs-refund",
    actingPlayerId: "alice",
    choiceIndex: 1,
    getCardDefinitionById: (id: string) => defMap.get(id),
    getRegisteredTriggeredEffectActions:
      lookups.getRegisteredTriggeredEffectActions,
    recordedUsage: {
      effectLabel: "magic:choice:1",
      usageLimit: C21_VARIANT_LIMIT,
    },
  });
}

describe("BSTH01-C21: unlessAffectedByOpponent 払い戻しは変種別ラベルで効く", () => {
  it("相手の restrict_end_attack_step に妨害された使用は変種別記録が払い戻される", () => {
    const state = makeRefundState(true);
    const after = runBlazingStarEndAttack(state);
    expect(after.step).toBe("attack");
    expect(
      after.log.some((l) =>
        l.startsWith("effect:end_attack_step:blocked-by-restriction:")
      )
    ).toBe(true);
    // 変種別ラベルの記録が払い戻され、同変種を再使用できる
    expect(after.effectUsageRecords).toHaveLength(0);
    expect(
      after.log.some((l) =>
        l.startsWith("effect:usage-refund:affected-by-opponent:")
      )
    ).toBe(true);
  });

  it("妨害なく解決した使用は変種別記録が残る (ゲーム1回封鎖が立つ)", () => {
    const state = makeRefundState(false);
    const queued = runBlazingStarEndAttack(state);
    expect(queued.pendingAttackStepEndFinalizations).toHaveLength(1);
    const after = finalizePendingAttackStepEndFinalizations(queued);
    expect(after.step).toBe("end");
    expect(after.effectUsageRecords).toHaveLength(1);
    expect(after.effectUsageRecords[0]!.effectLabel).toBe("magic:choice:1");
  });
});
