/**
 * ENGINE-registration-step-zero-to-n-target-selection の engine 側回帰テスト。
 *
 * 「ことで」連結 (connector:"conditional_cost") + 可変対象 (count {min:0, max:N}) で
 * pendingEffectTargetSelection が立ち、player が 0..N 体を能動選択できることを assert する:
 *   - 1 体以上選択 → cost 支払い + 効果成立
 *   - 0 体選択 (能動空選択) → 10_rules/03c §「○○することで△△する」双方向チェックにより
 *     △△ 不発 → cost rollback
 *
 * 実装ポイント:
 *   1. effect-interpreter.ts `isConditionalCostTargetShortage` を count {min,max} に拡張
 *      (length < max(min, 1) を shortage とみなす)
 *   2. legal-actions-apply.ts `applyPendingEffectTargetAction` で resumedStack に
 *      `targetSelectionResolved: true` を set し、resolveDeferredStackAction が
 *      getStackTargetSelection を再オープンしないようにする (空選択ループ防止)
 *
 * 注: 実カード BSGE01-C06 effects[1] は同じ idiom だが brave (合体側) のため、
 *   別途 ENGINE-brave-attached-member-attack-dispatch (battle_immediate の brave member
 *   dispatch) が未配線で production 経路では発火しない。本テストは engine path のみを
 *   exercise するため synthetic spirit ソースを使用する。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState, LegalAction } from "../src";

const SOURCE_CARD: CardDefinition = {
  cardNo: "TEST-CONDCOST-ZERO-N-SRC",
  name: "テスト用 ことで 0..N 対象 source",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  symbolColors: ["green"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      // 『アタック時』カウント-2 することで、相手のスピリット/アルティメット2体まで重疲労。
      // BSGE01-C06 effects[1] と同型 (brave 側だけが違う)。
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "count_decrease",
            player: "self",
            amount: 2,
          },
        },
        {
          id: "heavy_exhaust",
          action: {
            kind: "set_exhaust_state",
            state: "heavily_exhausted",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit", "ultimate"] },
              count: { min: 0, max: 2 },
            },
          },
          connector: "conditional_cost",
        },
      ],
    },
  ],
};

const TARGET_SPIRIT: CardDefinition = {
  cardNo: "TEST-CONDCOST-ZERO-N-TARGET",
  name: "テスト用相手スピリット",
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

const cardNoMap = new Map<string, CardDefinition>([
  [SOURCE_CARD.cardNo, SOURCE_CARD],
  [TARGET_SPIRIT.cardNo, TARGET_SPIRIT],
]);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const TEST_CARDS = [SOURCE_CARD, TARGET_SPIRIT];
const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(TEST_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(TEST_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(TEST_CARDS),
};

function buildScenario(countValue: number): GameState {
  const lookup = effectLookups.getRegisteredBattleImmediateEffectActions;
  const regs = lookup(SOURCE_CARD.cardNo) ?? [];
  const registrationIndex = regs.findIndex(
    (reg) => reg.timing === "attack" && reg.effectIndex === 0
  );
  if (registrationIndex < 0) {
    throw new Error("source battle immediate attack registration missing");
  }
  const attackReg = regs[registrationIndex]!;

  const source = createCardInstance(SOURCE_CARD, {
    instanceId: "src",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
  });
  const opp1 = createCardInstance(TARGET_SPIRIT, {
    instanceId: "opp-1",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 1,
  });
  const opp2 = createCardInstance(TARGET_SPIRIT, {
    instanceId: "opp-2",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 1,
  });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [{ countValue }, { countValue: 0 }],
    cardInstances: [source, opp1, opp2],
    battleImmediateEffects: [
      {
        promptId: "bi-src",
        attackId: "attack-src",
        timing: "attack" as const,
        sourceKind: attackReg.sourceKind,
        sourceInstanceId: source.instanceId,
        sourceDefinitionId: SOURCE_CARD.cardNo,
        sourceCardNo: SOURCE_CARD.cardNo,
        actingPlayerId: "alice",
        participantEntityId: "battle-entity:src",
        registrationIndex,
      },
    ],
  });
  return {
    ...base,
    activePlayerId: "alice",
    step: "attack" as const,
    window: "declare_attack" as const,
    turnNumber: 2,
  };
}

function findDeclaration(
  state: GameState
): Extract<LegalAction, { kind: "resolve_battle_immediate_effect" }> {
  const actions = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById,
    ...effectLookups,
  });
  const action = actions.find(
    (
      a
    ): a is Extract<LegalAction, { kind: "resolve_battle_immediate_effect" }> =>
      a.kind === "resolve_battle_immediate_effect" &&
      a.sourceCardNo === SOURCE_CARD.cardNo &&
      !a.skipOnly
  );
  if (!action) {
    throw new Error("expected resolve_battle_immediate_effect to be legal");
  }
  return action;
}

function passUntilStackClosed(state: GameState): GameState {
  let cur = state;
  for (let i = 0; i < 16 && cur.stackWindow !== null; i++) {
    const priority = cur.stackWindow.priorityPlayerId;
    const turn = getLegalActions({
      state: cur,
      actingPlayerId: priority,
      getCardDefinitionById,
      ...effectLookups,
    });
    const pass = turn.find((a) => a.kind === "pass_stack");
    if (!pass) break;
    cur = applyLegalAction({
      state: cur,
      action: pass,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
  }
  return cur;
}

function resolveEffectTarget(state: GameState, targets: string[]): GameState {
  const pending = state.pendingEffectTargetSelection;
  if (!pending) throw new Error("expected pendingEffectTargetSelection");
  const actions = getLegalActions({
    state,
    actingPlayerId: pending.actingPlayerId,
    getCardDefinitionById,
    ...effectLookups,
  });
  const resolveAction = actions.find(
    (a) => a.kind === "resolve_pending_effect_target"
  );
  if (!resolveAction) {
    throw new Error("expected resolve_pending_effect_target action");
  }
  return applyLegalAction({
    state,
    action: resolveAction,
    targetInstanceIds: targets,
    getCardDefinitionById,
    ...effectLookups,
  }).state;
}

describe("ENGINE: conditional_cost + count {min:0, max:N} の player 能動 0..N 選択", () => {
  it("registration が requiredTargetCount=0 / maxTargetCount=2 + conditional_cost gate を伝搬する", () => {
    const lookup = buildBattleImmediateEffectLookup([SOURCE_CARD]);
    const reg = lookup(SOURCE_CARD.cardNo)?.find(
      (r) => r.timing === "attack" && r.effectIndex === 0
    );
    expect(reg).toBeDefined();
    expect(reg!.requiredTargetCount).toBe(0);
    expect(reg!.maxTargetCount).toBe(2);
    expect(reg!.targetGatedByConditionalCost).toBe(true);
    expect(reg!.requiredCountCostAmount).toBe(2);
    expect(reg!.requiredCountCostPlayer).toBe("self");
  });

  it("deferred target pending → 1 体選択: cost (count -2) 支払い + 重疲労 1 体成立", () => {
    const initial = buildScenario(5);
    const decl = findDeclaration(initial);
    const declared = applyLegalAction({
      state: initial,
      action: decl,
      getCardDefinitionById,
      ...effectLookups,
    });
    const afterStack = passUntilStackClosed(declared.state);
    expect(afterStack.pendingEffectTargetSelection).not.toBeNull();
    const resolved = resolveEffectTarget(afterStack, ["opp-1"]);

    expect(resolved.players.find((p) => p.id === "alice")!.countValue).toBe(3);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "opp-1")!.exhaustState
    ).toBe("heavily_exhausted");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "opp-2")!.exhaustState
    ).not.toBe("heavily_exhausted");
  });

  it("deferred target pending → 0 体選択 (能動空選択): 双方向チェックで cost 不払い + 重疲労なし", () => {
    const initial = buildScenario(5);
    const decl = findDeclaration(initial);
    const declared = applyLegalAction({
      state: initial,
      action: decl,
      getCardDefinitionById,
      ...effectLookups,
    });
    const afterStack = passUntilStackClosed(declared.state);
    expect(afterStack.pendingEffectTargetSelection).not.toBeNull();
    // 0 体確定: 双方向チェックで「ことで」全体不発、cost rollback
    const resolved = resolveEffectTarget(afterStack, []);

    expect(resolved.players.find((p) => p.id === "alice")!.countValue).toBe(5);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "opp-1")!.exhaustState
    ).not.toBe("heavily_exhausted");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "opp-2")!.exhaustState
    ).not.toBe("heavily_exhausted");
    expect(
      resolved.log.some((l) =>
        l.startsWith("effect:conditional-cost-effect-failed:")
      )
    ).toBe(true);
    expect(
      resolved.log.some((l) =>
        l.startsWith("effect:conditional-cost-target-shortage:")
      )
    ).toBe(true);
    // 空選択ループ防止: pendingEffectTargetSelection は再オープンせず resolve 完了。
    expect(resolved.pendingEffectTargetSelection).toBeNull();
  });
});
